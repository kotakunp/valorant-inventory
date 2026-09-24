// Headless-Chromium cookie reauth fallback: Node's fetch TLS fingerprint is
// rejected by Riot's WAF more often than a real browser. Inject the pasted
// Riot cookies into Playwright Chromium and navigate to GET /authorize —
// success is the playvalorant.com/opt_in#access_token=… redirect.
// RULES: cookie values live only inside this call; never logged.

import { chromium, type BrowserContext } from "playwright-core";
import path from "node:path";
import fs from "node:fs";
import { AuthFlowError, parseTokenLocation } from "./riotAuth";

const REAUTH_URL =
  "https://auth.riotgames.com/authorize?redirect_uri=https%3A%2F%2Fplayvalorant.com%2Fopt_in" +
  "&client_id=play-valorant-web-prod&response_type=token%20id_token&nonce=1&scope=account%20openid";

const LAUNCH_ARGS = [
  "--no-sandbox",
  "--disable-dev-shm-usage",
  "--disable-gpu",
  "--disable-blink-features=AutomationControlled",
];

function candidateExecutables(): string[] {
  const out: string[] = [];
  const env = process.env.CHROME_PATH?.trim();
  if (env) out.push(env);
  const names = ["chromium", "chromium-browser", "google-chrome", "google-chrome-stable", "chrome"];
  const pathDirs = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  for (const name of names) {
    for (const dir of pathDirs) {
      const full = path.join(dir, name);
      try {
        fs.accessSync(full, fs.constants.X_OK);
        out.push(full);
      } catch {
        /* not here */
      }
    }
  }
  out.push(
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
    "/nix/var/nix/profiles/default/bin/chromium"
  );
  return [...new Set(out)];
}

async function launch(): Promise<BrowserContext> {
  const execs = candidateExecutables();
  const errors: string[] = [];
  for (const executablePath of execs) {
    try {
      const browser = await chromium.launch({ executablePath, headless: true, args: LAUNCH_ARGS });
      return await browser.newContext();
    } catch (e) {
      errors.push(`${path.basename(executablePath)}: ${e instanceof Error ? e.message.slice(0, 80) : e}`);
    }
  }
  try {
    const browser = await chromium.launch({ headless: true, args: LAUNCH_ARGS });
    return await browser.newContext();
  } catch (e) {
    errors.push(`playwright-chromium: ${e instanceof Error ? e.message.slice(0, 80) : e}`);
  }
  throw new AuthFlowError(
    `Headless Chromium unavailable for cookie reauth — ${errors.slice(0, 3).join("; ")}`,
    502
  );
}

/** pairs from parseCookieInput → Playwright cookies on .riotgames.com. */
function toPlaywrightCookies(pairs: Array<[string, string]>) {
  return pairs
    .filter(([, v]) => v)
    .map(([name, value]) => ({
      name,
      value,
      domain: ".riotgames.com",
      path: "/",
      httpOnly: true,
      secure: true,
      sameSite: "Lax" as const,
    }));
}

export async function reauthViaBrowser(
  pairs: Array<[string, string]>
): Promise<{ accessToken: string; idToken: string }> {
  if (!pairs.some(([n]) => n === "ssid")) {
    throw new AuthFlowError("Login session cookie missing — please sign in again.", 401);
  }
  let ctx: BrowserContext | null = null;
  try {
    ctx = await launch();
    await ctx.addCookies(toPlaywrightCookies(pairs));
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    await page.goto(REAUTH_URL, { waitUntil: "commit", timeout: 20000 }).catch(() => {});
    // Follow the OAuth redirect chain to playvalorant.com/opt_in#access_token=…
    // or bounce to authenticate.riotgames.com/login (failure).
    const deadline = Date.now() + 15000;
    let url = "";
    while (Date.now() < deadline) {
      url = page.url();
      const parsed = parseTokenLocation(url);
      if (parsed) return parsed;
      if (url.includes("authenticate.riotgames.com/login")) break;
      if (url.includes("playvalorant.com/opt_in")) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    url = page.url();
    const parsed = parseTokenLocation(url);
    if (parsed) return parsed;
    throw new AuthFlowError(
      url.includes("authenticate.riotgames.com/login")
        ? "Browser reauth redirected to the login page — the cookie was rejected (expired or wrong domain)."
        : "Browser reauth ended at an unexpected URL (HTTP flow incomplete).",
      401
    );
  } finally {
    if (ctx) await ctx.close().catch(() => {});
  }
}
