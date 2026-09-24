// Remote browser for hosted/VPS AUTO LOGIN: no local Chrome required.
// Launches a server-side Chromium (Playwright), streams frames to the UI,
// forwards input, and harvests Riot cookies when the user finishes login
// on Riot's real domain (captcha/2FA stay on Riot's page — host OK).
// RULES: cookie values live only in this request chain; never logged.

import { chromium, type BrowserContext, type Page } from "playwright-core";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { AuthFlowError, loginWithCookies, type AuthResult } from "./riotAuth";
import { riotCookieHeader } from "./browserLogin";
import { buildShowcase } from "./valorant";
import type { ShowcasePayload } from "../src/types";
import type { Region } from "../src/types";

const LOGIN_URL = "https://account.riotgames.com/";
const SESSION_TTL_MS = 5 * 60_000;
const FRAME_JPEG_QUALITY = 70;
const VIEWPORT = { width: 1280, height: 800 };

export type BrowserPhase = "starting" | "login" | "harvesting" | "done" | "error" | "expired";

export interface BrowserStatus {
  active: boolean;
  phase: BrowserPhase;
  width: number;
  height: number;
  error?: string;
}

interface RemoteSession {
  id: string;
  ctx: BrowserContext;
  page: Page;
  cdp: import("playwright-core").CDPSession | null;
  createdAt: number;
  phase: BrowserPhase;
  error?: string;
  result: ShowcasePayload | null;
  frameLoop: Promise<void> | null;
  lastFrame: Buffer | null;
  width: number;
  height: number;
  stopping: boolean;
}

let session: RemoteSession | null = null;

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

async function launchContext(): Promise<BrowserContext> {
  const base = {
    headless: true,
    viewport: VIEWPORT,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  };
  const execs = candidateExecutables();
  let lastErr: unknown = null;
  if (execs.length > 0) {
    for (const executablePath of execs) {
      try {
        return await chromium.launchPersistentContext(profileDir(), {
          ...base,
          executablePath,
        });
      } catch (e) {
        lastErr = e;
        /* try next */
      }
    }
  }
  // Fall back to system channel names (works on dev machines with Chrome/Edge).
  try {
    return await chromium.launchPersistentContext(profileDir(), { ...base, channel: "chrome" });
  } catch (e) {
    lastErr = e;
  }
  try {
    return await chromium.launchPersistentContext(profileDir(), { ...base, channel: "msedge" });
  } catch (e) {
    lastErr = e;
  }
  const checked = execs.length ? execs.join(", ") : "(none on PATH)";
  const reason = lastErr instanceof Error ? lastErr.message.slice(0, 200) : "unknown";
  throw new AuthFlowError(
    "Remote browser unavailable — Chromium failed to launch on the server. " +
      `Checked: ${checked}. Last error: ${reason}. ` +
      "Ensure nixpacks installs chromium (nixPkgs) or set CHROME_PATH, or paste the ssid cookie.",
    503
  );
}

function profileDir(): string {
  return path.join(os.homedir(), ".valorant-store", "remote-profile");
}

/** CDP screencast — keeps streaming during page.goto (page.screenshot hangs on navigate). */
async function startScreencast(s: RemoteSession): Promise<void> {
  try {
    const cdp = await s.page.context().newCDPSession(s.page);
    s.cdp = cdp;
    cdp.on("Page.screencastFrame", (params: { data: string; sessionId: number }) => {
      if (s.stopping || session !== s) return;
      try {
        s.lastFrame = Buffer.from(params.data, "base64");
      } catch {
        /* bad frame */
      }
      void cdp.send("Page.screencastFrameAck", { sessionId: params.sessionId }).catch(() => {});
    });
    await cdp.send("Page.enable");
    await cdp.send("Page.startScreencast", {
      format: "jpeg",
      quality: FRAME_JPEG_QUALITY,
      maxWidth: VIEWPORT.width,
      maxHeight: VIEWPORT.height,
      everyNthFrame: 1,
    });
  } catch {
    s.cdp = null;
    await captureFallbackLoop(s);
  }
}

/** Fallback if CDP screencast unavailable — screenshot with hard timeout so navigation cannot freeze it. */
async function captureFallbackLoop(s: RemoteSession): Promise<void> {
  while (!s.stopping && session === s) {
    try {
      const buf = await Promise.race([
        s.page.screenshot({ type: "jpeg", quality: FRAME_JPEG_QUALITY, timeout: 2000 }),
        new Promise<Buffer>((_, rej) => setTimeout(() => rej(new Error("shot timeout")), 2500)),
      ]);
      s.lastFrame = Buffer.from(buf);
    } catch {
      /* navigating */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
}

async function harvestAndFinish(s: RemoteSession): Promise<void> {
  if (s.phase !== "login") return;
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
    // Partial cookies (mid-login) → stay in login and retry.
    if (e instanceof AuthFlowError && e.status === 401 && s.phase === "harvesting") {
      s.phase = "login";
      return;
    }
    s.phase = "error";
    s.error = e instanceof Error ? e.message : "Remote login failed.";
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

export async function startRemoteBrowser(region: Region): Promise<BrowserStatus> {
  pruneIfStale();
  if (session && session.phase !== "done" && session.phase !== "error" && session.phase !== "expired") {
    if (session.phase === "login" || session.phase === "starting" || session.phase === "harvesting") {
      return status();
    }
  }
  await closeSession("expired");

  let ctx: BrowserContext;
  try {
    ctx = await launchContext();
  } catch (e) {
    throw e;
  }

  const page = ctx.pages()[0] ?? (await ctx.newPage());
  const s: RemoteSession = {
    id: crypto.randomUUID(),
    ctx,
    page,
    cdp: null,
    createdAt: Date.now(),
    phase: "login",
    result: null,
    frameLoop: null,
    lastFrame: null,
    width: VIEWPORT.width,
    height: VIEWPORT.height,
    stopping: false,
  };
  session = s;

  // Screencast first so frames stream while page.goto runs (screenshot would hang).
  s.frameLoop = startScreencast(s);
  startPoller(s);

  void (async () => {
    try {
      await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 45_000 });
    } catch {
      /* SPA/network slow — frames still stream; user can retry Close */
    }
  })();
  // region is consumed when harvest finishes via auth.region fallback; keep param for API symmetry
  void region;
  return status();
}

export function status(): BrowserStatus {
  pruneIfStale();
  if (!session) {
    return { active: false, phase: "expired", width: VIEWPORT.width, height: VIEWPORT.height };
  }
  return {
    active: true,
    phase: session.phase,
    width: session.width,
    height: session.height,
    ...(session.error ? { error: session.error } : {}),
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
