// Remote browser for hosted/VPS AUTO LOGIN: no local Chrome required.
// Launches a server-side Chromium (Playwright), streams frames to the UI,
// forwards input, and harvests Riot cookies when the user finishes login
// on Riot's real domain (captcha/2FA stay on Riot's page — host OK).
// RULES: cookie values live only in this request chain; never logged.

import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { AuthFlowError, loginWithCookies } from "./riotAuth";
import { riotCookieHeader } from "./browserLogin";
import { buildShowcase } from "./valorant";
import type { ShowcasePayload } from "../src/types";
import type { Region } from "../src/types";

const LOGIN_URL = "https://account.riotgames.com/";
const SESSION_TTL_MS = 5 * 60_000;
const FRAME_JPEG_QUALITY = 70;
const VIEWPORT = { width: 1280, height: 800 };
// Realistic UA — headless default UA trips Riot/Akamai loaders.
const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
// Playwright already injects a long --disable-features list; a second one
// overrides it and destabilizes the renderer. Do NOT add --disable-features here.
const LAUNCH_ARGS = [
  "--no-sandbox",
  "--disable-dev-shm-usage",
  "--disable-gpu",
  "--disable-blink-features=AutomationControlled",
  "--disable-background-timer-throttling",
  "--disable-renderer-backgrounding",
  "--disable-backgrounding-occluded-windows",
];

/** Hide automation fingerprints before any page script runs. */
const STEALTH_INIT = `
  Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  if (!window.chrome) window.chrome = { runtime: {} };
  Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3, 4, 5] });
  Object.defineProperty(navigator, "languages", { get: () => ["en-US", "en"] });
  const originalQuery = window.navigator.permissions.query.bind(window.navigator.permissions);
  window.navigator.permissions.query = (parameters) =>
    parameters && parameters.name === "notifications"
      ? Promise.resolve({ state: Notification.permission })
      : originalQuery(parameters);
`;

export type BrowserPhase = "starting" | "login" | "harvesting" | "done" | "error" | "expired";

export interface BrowserStatus {
  active: boolean;
  phase: BrowserPhase;
  width: number;
  height: number;
  error?: string;
  url?: string;
  frames?: number;
  frameAgeMs?: number;
  captureErr?: string;
}

interface RemoteSession {
  id: string;
  browser: Browser;
  ctx: BrowserContext;
  page: Page;
  cdp: import("playwright-core").CDPSession | null;
  createdAt: number;
  phase: BrowserPhase;
  error?: string;
  result: ShowcasePayload | null;
  frameLoop: Promise<void> | null;
  lastFrame: Buffer | null;
  lastFrameAt: number;
  frameCount: number;
  captureErr?: string;
  width: number;
  height: number;
  stopping: boolean;
  crashed?: boolean;
  relaunching?: boolean;
  relaunchCount: number;
  /** One-shot form credentials — request memory only, never logged, cleared after fill. */
  pendingCreds?: { username: string; password: string };
}

let session: RemoteSession | null = null;
let startLock: Promise<unknown> = Promise.resolve();

const MAX_RELAUNCHES = 2;

function pruneIfStale(): void {
  if (!session) return;
  if (Date.now() - session.createdAt > SESSION_TTL_MS && session.phase !== "done") {
    void closeSession("expired");
  }
}

async function closeSession(phase: BrowserPhase = "expired"): Promise<void> {
  const s = session;
  session = null;
  if (!s) return;
  s.stopping = true;
  s.phase = phase;
  try {
    await s.cdp?.send("Page.stopScreencast").catch(() => {});
  } catch {
    /* ignore */
  }
  try {
    await s.ctx.close();
  } catch {
    /* already closed */
  }
  try {
    await s.browser.close();
  } catch {
    /* already closed */
  }
  // Relaunch paths leave orphan chromium processes that pin the old profile.
  try {
    const out = await import("node:child_process").then((m) =>
      m.execSync("pkill -f playwright_chromiumdev_profile || true", { stdio: "ignore", timeout: 3000 })
    );
    void out;
  } catch {
    /* best-effort */
  }
}

function candidateExecutables(): string[] {
  const out: string[] = [];
  const env = process.env.CHROME_PATH?.trim();
  if (env) out.push(env);

  // PATH lookup first — nixpacks/nix put `chromium` on PATH, not /usr/bin/chromium.
  const names = [
    "chromium",
    "chromium-browser",
    "google-chrome",
    "google-chrome-stable",
    "chrome",
    "microsoft-edge",
    "microsoft-edge-stable",
  ];
  const pathDirs = (process.env.PATH ?? "")
    .split(path.delimiter)
    .map((d) => d.trim())
    .filter(Boolean);
  for (const name of names) {
    for (const dir of pathDirs) {
      const full = path.join(dir, name);
      try {
        if (fs.existsSync(full)) out.push(full);
      } catch {
        /* ignore */
      }
    }
  }

  // Absolute fallbacks (apt / macOS)
  out.push(
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/microsoft-edge",
    "/usr/bin/microsoft-edge-stable",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/Applications/Chromium.app/Contents/MacOS/Chromium"
  );

  const seen = new Set<string>();
  return out.filter((p) => {
    if (!p || seen.has(p)) return false;
    seen.add(p);
    try {
      return fs.existsSync(p);
    } catch {
      return false;
    }
  });
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message.replace(/\s+/g, " ").slice(0, 180) : "unknown error";
}

async function launchSession(): Promise<{ browser: Browser; ctx: BrowserContext }> {
  const errors: string[] = [];
  const execs = candidateExecutables();
  // Prefer headed when DISPLAY is set (xvfb) — avoids headless bot walls.
  const headless = !process.env.DISPLAY;

  const tryLaunch = async (opts: { executablePath?: string; channel?: "chrome" }) => {
    const browser = await chromium.launch({ ...opts, headless, args: LAUNCH_ARGS });
    const ctx = await browser.newContext({ viewport: VIEWPORT, userAgent: UA });
    await ctx.addInitScript(STEALTH_INIT);
    return { browser, ctx };
  };

  // 1) Playwright-managed Chromium (matches browsers.json — avoids CDP version skew).
  try {
    return await tryLaunch({});
  } catch (e) {
    errors.push(`playwright-chromium: ${errText(e)}`);
  }

  // 2) System executables (dev machines / fallback).
  for (const executablePath of execs) {
    try {
      return await tryLaunch({ executablePath });
    } catch (e) {
      errors.push(`${path.basename(executablePath)}: ${errText(e)}`);
    }
  }

  try {
    return await tryLaunch({ channel: "chrome" });
  } catch (e) {
    errors.push(`chrome-channel: ${errText(e)}`);
  }

  if (execs.length > 0) {
    try {
      fs.rmSync(profileDir(), { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    try {
      const ctx = await chromium.launchPersistentContext(profileDir(), {
        headless,
        viewport: VIEWPORT,
        userAgent: UA,
        executablePath: execs[0],
        args: LAUNCH_ARGS,
      });
      await ctx.addInitScript(STEALTH_INIT);
      const browser = ctx.browser();
      if (!browser) {
        await ctx.close();
        throw new Error("persistent context had no browser");
      }
      return { browser, ctx };
    } catch (e) {
      errors.push(`persistent: ${errText(e)}`);
    }
  }

  const checked = execs.length ? execs.join(", ") : "(none on PATH)";
  throw new AuthFlowError(
    "Remote browser unavailable — Chromium failed to launch on the server. " +
      `Checked: ${checked}. Attempts: ${errors.join(" | ")}. ` +
      "Ensure nixpacks runs `npx playwright-core install chromium`, or paste the ssid cookie.",
    503
  );
}

function profileDir(): string {
  return path.join(os.homedir(), ".valorant-store", "remote-profile");
}

/**
 * Continuous frame capture with self-healing.
 * If screenshots fail repeatedly, drop/recreate the CDP session and keep trying —
 * never let the loop exit (a dead loop = frozen UI).
 */
async function startCaptureLoop(s: RemoteSession): Promise<void> {
  let fails = 0;
  const attachCdp = async () => {
    try {
      if (s.page.isClosed()) return;
      if (s.cdp) {
        try {
          await s.cdp.send("Page.stopScreencast").catch(() => {});
        } catch {
          /* ignore */
        }
        s.cdp = null;
      }
      const cdp = await s.page.context().newCDPSession(s.page);
      s.cdp = cdp;
      cdp.on("Page.screencastFrame", (params: { data: string; sessionId: number }) => {
        if (s.stopping || session !== s) return;
        try {
          s.lastFrame = Buffer.from(params.data, "base64");
          s.lastFrameAt = Date.now();
          s.frameCount += 1;
          s.captureErr = undefined;
          fails = 0;
        } catch {
          /* bad frame */
        }
        void cdp.send("Page.screencastFrameAck", { sessionId: params.sessionId }).catch(() => {});
      });
      cdp.on("close", () => {
        if (session === s) s.cdp = null;
      });
      await cdp.send("Page.enable");
      await cdp.send("Page.startScreencast", {
        format: "jpeg",
        quality: FRAME_JPEG_QUALITY,
        maxWidth: VIEWPORT.width,
        maxHeight: VIEWPORT.height,
        everyNthFrame: 1,
      });
    } catch (e) {
      s.cdp = null;
      s.captureErr = `cdp: ${errText(e)}`;
    }
  };

  await attachCdp();

  while (!s.stopping && session === s && !s.crashed) {
    if (s.page.isClosed()) break;
    let got: Buffer | null = null;
    let lastFail = "";

    // Screencast frames (if any) already updated lastFrameAt — only force a
    // screenshot when the stream has been quiet. Hammering captureScreenshot
    // on a mismatched Chromium was crashing the renderer.
    const screencastFresh = Date.now() - s.lastFrameAt < 800;
    if (s.cdp && !screencastFresh) {
      try {
        const shot = (await Promise.race([
          s.cdp.send("Page.captureScreenshot", { format: "jpeg", quality: FRAME_JPEG_QUALITY }),
          new Promise<never>((_, rej) => setTimeout(() => rej(new Error("cdp timeout")), 2500)),
        ])) as { data: string };
        got = Buffer.from(shot.data, "base64");
      } catch (e) {
        lastFail = `cdp: ${errText(e)}`;
      }
    }
    if (!got && !screencastFresh) {
      try {
        const buf = await Promise.race([
          s.page.screenshot({ type: "jpeg", quality: FRAME_JPEG_QUALITY, timeout: 2500, caret: "initial" }),
          new Promise<Buffer>((_, rej) => setTimeout(() => rej(new Error("pw timeout")), 3000)),
        ]);
        if (buf && buf.length > 0) got = Buffer.from(buf);
        else lastFail = "pw: empty";
      } catch (e) {
        lastFail = `pw: ${errText(e)}`;
      }
    }

    if (got) {
      s.lastFrame = got;
      s.lastFrameAt = Date.now();
      s.frameCount += 1;
      s.captureErr = undefined;
      fails = 0;
    } else if (!screencastFresh) {
      fails += 1;
      s.captureErr = lastFail || "no frame";
      if (/Target crashed|Target closed|browser has been closed/i.test(s.captureErr)) {
        s.crashed = true;
        break;
      }
      if (fails >= 4) {
        fails = 0;
        await attachCdp();
      }
    }
    await new Promise((r) => setTimeout(r, got ? 400 : 600));
  }
}

function wirePage(s: RemoteSession, page: Page): void {
  page.on("console", (msg) => {
    if (msg.type() === "error") console.warn(`[remote-browser] console: ${msg.text().slice(0, 200)}`);
  });
  page.on("pageerror", (err) => {
    console.warn(`[remote-browser] pageerror: ${String(err).slice(0, 200)}`);
  });
  page.on("crash", () => {
    if (session !== s || s.stopping) return;
    console.warn("[remote-browser] page crashed — scheduling relaunch");
    s.crashed = true;
    void maybeRelaunch(s);
  });
}

/** Tear down a crashed browser and launch a fresh one (capped attempts). */
async function maybeRelaunch(s: RemoteSession): Promise<void> {
  if (s.stopping || session !== s) return;
  if (s.relaunching) return;
  if (s.relaunchCount >= MAX_RELAUNCHES) {
    s.phase = "error";
    s.error = "Chromium crashed repeatedly on this server. Close and try again, or paste the ssid cookie.";
    s.stopping = true;
    console.warn("[remote-browser] giving up after max relaunches");
    // Keep session object so status() can surface the error; tear down browsers only.
    try {
      await s.ctx.close().catch(() => {});
    } catch {
      /* ignore */
    }
    try {
      await s.browser.close().catch(() => {});
    } catch {
      /* ignore */
    }
    s.cdp = null;
    return;
  }
  s.relaunching = true;
  s.relaunchCount += 1;
  try {
    try {
      await s.ctx.close().catch(() => {});
      await s.browser.close().catch(() => {});
    } catch {
      /* already dead */
    }
    // Sweep orphans from prior launches before starting a new browser.
    await import("node:child_process").then(
      (m) =>
        new Promise<void>((resolve) => {
          const p = m.spawn("pkill", ["-f", "playwright_chromiumdev_profile"], { stdio: "ignore" });
          p.on("close", () => resolve());
          setTimeout(resolve, 2000);
        })
    ).catch(() => {});
    if (s.stopping || session !== s) return;

    const launched = await launchSession();
    const page = launched.ctx.pages()[0] ?? (await launched.ctx.newPage());
    s.browser = launched.browser;
    s.ctx = launched.ctx;
    s.page = page;
    s.cdp = null;
    s.crashed = false;
    s.captureErr = undefined;
    s.lastFrameAt = Date.now();
    s.phase = "login";
    wirePage(s, page);
    s.frameLoop = startCaptureLoop(s);
    s.frameLoop.catch((e) => {
      s.captureErr = `loop crashed: ${errText(e)}`;
      console.error("[remote-browser] capture loop crashed:", e);
    });
    await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 45_000 }).catch(() => {});
    console.warn(`[remote-browser] relaunched (#${s.relaunchCount})`);
  } catch (e) {
    s.phase = "error";
    s.error = `Chromium crashed and could not restart: ${errText(e)}`;
    s.stopping = true;
    console.warn("[remote-browser] relaunch failed:", s.error);
    try {
      await s.ctx.close().catch(() => {});
    } catch {
      /* ignore */
    }
    try {
      await s.browser.close().catch(() => {});
    } catch {
      /* ignore */
    }
    s.cdp = null;
  } finally {
    s.relaunching = false;
  }
}

/**
 * Fill Riot's login form from our own email/password UI.
 * Captcha still runs on Riot's page (host-locked) — user only solves that (and 2FA).
 * Credentials are used once then dropped from the session; never logged.
 */
async function prefillRiotForm(s: RemoteSession): Promise<void> {
  const creds = s.pendingCreds;
  if (!creds) return;
  s.pendingCreds = undefined;
  if (s.stopping || session !== s) return;

  const { username, password } = creds;
  const page = s.page;
  const fillAny = async (selectors: string[], value: string): Promise<boolean> => {
    for (const sel of selectors) {
      try {
        const loc = page.locator(sel).first();
        if ((await loc.count()) > 0 && (await loc.isVisible().catch(() => false))) {
          await loc.fill(value, { timeout: 4000 });
          return true;
        }
      } catch {
        /* try next */
      }
    }
    return false;
  };

  try {
    // Username / email step
    const userSel = [
      'input[type="email"]',
      'input[name="username"]',
      'input[name="login"]',
      'input[autocomplete="username"]',
      'input[id*="username" i]',
      'input[id*="email" i]',
      'input[type="text"]',
    ];
    let filledUser = await fillAny(userSel, username);
    if (!filledUser) {
      // Form not up yet — wait briefly
      for (let i = 0; i < 15 && !filledUser && !s.stopping && session === s; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        filledUser = await fillAny(userSel, username);
      }
    }
    if (!filledUser || s.stopping || session !== s) return;

    // Advance past username if password isn't visible yet
    let filledPass = await fillAny(
      ['input[type="password"]', 'input[autocomplete="current-password"]'],
      password
    );
    if (!filledPass) {
      const nextBtn = page.locator(
        'button[type="submit"], button:has-text("Sign In"), button:has-text("Next"), button:has-text("Continue")'
      ).first();
      try {
        if ((await nextBtn.count()) > 0 && (await nextBtn.isVisible().catch(() => false))) {
          await nextBtn.click({ timeout: 3000 });
        }
      } catch {
        /* ignore */
      }
      for (let i = 0; i < 10 && !filledPass && !s.stopping && session === s; i++) {
        await new Promise((r) => setTimeout(r, 800));
        filledPass = await fillAny(
          ['input[type="password"]', 'input[autocomplete="current-password"]'],
          password
        );
      }
    }
    if (!filledPass || s.stopping || session !== s) return;

    // Auto-submit only if no captcha challenge is on-screen (host-locked captcha needs the user).
    try {
      const captchaVisible = await page.evaluate(() => {
        const iframes = Array.from(document.querySelectorAll("iframe"));
        return iframes.some((f) => {
          const src = (f.getAttribute("src") || "").toLowerCase();
          return src.includes("hcaptcha") || src.includes("captcha");
        });
      });
      if (!captchaVisible) {
        const submit = page.locator('button[type="submit"]').first();
        if ((await submit.count()) > 0 && (await submit.isVisible().catch(() => false))) {
          await submit.click({ timeout: 3000 }).catch(() => {});
        }
      }
    } catch {
      /* leave form filled for the user */
    }
    console.warn("[remote-browser] prefilled Riot form (creds dropped)");
  } catch (e) {
    console.warn("[remote-browser] prefill failed:", errText(e));
  }
}

async function harvestAndFinish(s: RemoteSession): Promise<void> {
  if (s.phase !== "login") return;
  // Don't touch a browser that's crashed/relaunching — cookies() throws "closed".
  if (s.stopping || s.crashed || s.relaunching) return;
  try {
    if (s.page.isClosed() || !s.browser.isConnected()) return;
  } catch {
    return;
  }
  s.phase = "harvesting";
  try {
    const header = riotCookieHeader(await s.ctx.cookies());
    if (!header) {
      s.phase = "login";
      return;
    }
    const auth = await loginWithCookies(header);
    const payload = await buildShowcase({
      region: auth.region ?? "na",
      accessToken: auth.accessToken,
      entitlementsToken: auth.entitlementsToken,
      puuid: auth.puuid || undefined,
    });
    s.result = payload;
    s.phase = "done";
    // Keep the browser briefly so the UI can pull the result, then close.
    setTimeout(() => void closeSession("done"), 30_000);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Remote login failed.";
    // Closed browser mid-harvest → stay in login (or wait for relaunch), don't error out.
    if (/closed|crashed|Target page/i.test(msg)) {
      s.phase = "login";
      return;
    }
    // Partial cookies (mid-login) → stay in login and retry.
    if (e instanceof AuthFlowError && e.status === 401 && s.phase === "harvesting") {
      s.phase = "login";
      return;
    }
    s.phase = "error";
    s.error = msg;
  }
}

let pollTimer: ReturnType<typeof setInterval> | null = null;

function startPoller(s: RemoteSession): void {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(() => {
    void (async () => {
      pruneIfStale();
      if (!session || session !== s || s.phase !== "login") return;
      await harvestAndFinish(s);
    })();
  }, 1500);
}

export async function startRemoteBrowser(
  region: Region,
  creds?: { username?: string; password?: string }
): Promise<BrowserStatus> {
  const run = async (): Promise<BrowserStatus> => {
    pruneIfStale();
    if (session && session.phase !== "done" && session.phase !== "error" && session.phase !== "expired") {
      if (session.phase === "login" || session.phase === "starting" || session.phase === "harvesting") {
        return status();
      }
    }
    await closeSession("expired");

    let launched: { browser: Browser; ctx: BrowserContext };
    try {
      launched = await launchSession();
    } catch (e) {
      throw e;
    }

    const page = launched.ctx.pages()[0] ?? (await launched.ctx.newPage());
    const now = Date.now();
    const username = typeof creds?.username === "string" ? creds.username.trim() : "";
    const password = typeof creds?.password === "string" ? creds.password : "";
    const s: RemoteSession = {
      id: crypto.randomUUID(),
      browser: launched.browser,
      ctx: launched.ctx,
      page,
      cdp: null,
      createdAt: now,
      phase: "login",
      result: null,
      frameLoop: null,
      lastFrame: null,
      lastFrameAt: now,
      frameCount: 0,
      width: VIEWPORT.width,
      height: VIEWPORT.height,
      stopping: false,
      relaunchCount: 0,
      ...(username && password ? { pendingCreds: { username, password } } : {}),
    };
    session = s;

    wirePage(s, page);

    // Continuous capture: screencast + timed screenshot fallback so frames never freeze.
    s.frameLoop = startCaptureLoop(s);
    s.frameLoop.catch((e) => {
      s.captureErr = `loop crashed: ${errText(e)}`;
      console.error("[remote-browser] capture loop crashed:", e);
      if (!s.stopping && session === s) void maybeRelaunch(s);
    });
    startPoller(s);

    void (async () => {
      try {
        await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 45_000 });
        // Wait for the login form (not just shell). Soft-reload once if SPA never mounts.
        let hasForm = false;
        for (let i = 0; i < 20 && !s.stopping && session === s; i++) {
          await new Promise((r) => setTimeout(r, 1000));
          try {
            hasForm = await page.evaluate(
              () => !!document.querySelector('input[type="email"], input[type="text"], input[name*="login"], form')
            );
            if (hasForm) break;
          } catch {
            /* navigating */
          }
        }
        if (!hasForm && !s.stopping && session === s) {
          console.warn("[remote-browser] login form never mounted — reloading once");
          await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 45_000 }).catch(() => {});
          await new Promise((r) => setTimeout(r, 3000));
        }
        // Inject credentials from our own login UI (request memory only).
        if (!s.stopping && session === s) {
          await prefillRiotForm(s);
        }
      } catch {
        /* SPA/network slow — frames still stream */
      }
    })();
    // region is consumed when harvest finishes via auth.region fallback; keep param for API symmetry
    void region;
    return status();
  };

  // Serialize starts so concurrent requests don't race the single session slot.
  const next = startLock.then(run, run);
  startLock = next.catch(() => {});
  return next;
}

export function status(): BrowserStatus {
  pruneIfStale();
  if (!session) {
    return { active: false, phase: "expired", width: VIEWPORT.width, height: VIEWPORT.height };
  }
  let url = "";
  try {
    url = session.page.isClosed() ? "" : session.page.url();
  } catch {
    url = "";
  }
  return {
    active: session.phase !== "error",
    phase: session.phase,
    width: session.width,
    height: session.height,
    frames: session.frameCount,
    frameAgeMs: Date.now() - session.lastFrameAt,
    ...(session.captureErr ? { captureErr: session.captureErr } : {}),
    ...(session.error ? { error: session.error } : {}),
    ...(url ? { url } : {}),
  };
}

/** One-shot result for the UI once phase=done. Tokens never leave the server. */
export function takeResult(): ShowcasePayload | null {
  if (!session || session.phase !== "done") return null;
  return session.result;
}

export function latestFrame(): Buffer | null {
  pruneIfStale();
  return session?.lastFrame ?? null;
}

export type RemoteInput =
  | { type: "mousemove"; x: number; y: number }
  | { type: "mousedown"; x: number; y: number; button?: "left" | "right" | "middle" }
  | { type: "mouseup"; x: number; y: number; button?: "left" | "right" | "middle" }
  | { type: "click"; x: number; y: number; button?: "left" | "right" | "middle" }
  | { type: "wheel"; x: number; y: number; deltaX: number; deltaY: number }
  | { type: "keydown"; key: string }
  | { type: "keyup"; key: string }
  | { type: "type"; text: string }
  | { type: "press"; key: string }
  | { type: "scroll"; x: number; y: number };

export async function sendInput(input: RemoteInput): Promise<void> {
  if (!session || (session.phase !== "login" && session.phase !== "starting")) {
    throw new AuthFlowError("No active remote browser session.", 404);
  }
  try {
    const page = session.page;
    switch (input.type) {
      case "mousemove":
        await page.mouse.move(input.x, input.y);
        break;
      case "mousedown":
        await page.mouse.move(input.x, input.y);
        await page.mouse.down({ button: input.button ?? "left" });
        break;
      case "mouseup":
        await page.mouse.move(input.x, input.y);
        await page.mouse.up({ button: input.button ?? "left" });
        break;
      case "click":
        await page.mouse.click(input.x, input.y, { button: input.button ?? "left" });
        break;
      case "wheel":
        await page.mouse.move(input.x, input.y);
        await page.mouse.wheel(input.deltaX, input.deltaY);
        break;
      case "keydown":
        await page.keyboard.down(input.key);
        break;
      case "keyup":
        await page.keyboard.up(input.key);
        break;
      case "type":
        await page.keyboard.type(input.text, { delay: 20 });
        break;
      case "press":
        await page.keyboard.press(input.key);
        break;
      case "scroll":
        await page.mouse.move(input.x, input.y);
        await page.mouse.wheel(0, input.y);
        break;
      default:
        break;
    }
  } catch (e) {
    if (e instanceof AuthFlowError) throw e;
    throw new AuthFlowError(
      e instanceof Error ? `Remote input failed: ${e.message.slice(0, 160)}` : "Remote input failed.",
      502
    );
  }
}

export async function stopRemoteBrowser(): Promise<void> {
  await closeSession("expired");
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

/** Test helper — reset module state between unit tests. */
export function __resetRemoteBrowserForTests(): void {
  session = null;
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}
