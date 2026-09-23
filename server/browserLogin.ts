// Automated cookie acquisition: opens a dedicated-profile Chrome/Edge window
// (playwright-core, no bundled browser), lets the user log in on Riot's real
// page once, then harvests HttpOnly cookies and mints tokens via loginWithCookies.
// RULES: same as riotAuth — cookies live only inside this request chain; profile
// dir holds the browser session (same as Chrome itself), never our logs.

import { chromium, type BrowserContext, type Cookie } from "playwright-core";
import path from "node:path";
import os from "node:os";
import { AuthFlowError, loginWithCookies, type AuthResult } from "./riotAuth";
import { harvestChromeRiotCookies } from "./chromeCookies";

const PROFILE_DIR = path.join(os.homedir(), ".valorant-store", "chrome-profile");
const LOGIN_URL = "https://account.riotgames.com/";
const WAIT_MS = 5 * 60_000;
const MAX_ATTEMPTS = 5;

let busy = false;

/** Browser cookies → "ssid=…; asid=…" header for loginWithCookies.
 *  Riot domains only; "" when no ssid is present yet. */
export function riotCookieHeader(cookies: Array<Pick<Cookie, "name" | "value" | "domain">>): string {
  const riot = cookies.filter((c) => c.domain.includes("riotgames.com") && c.value);
  if (!riot.some((c) => c.name === "ssid")) return "";
  return riot.map((c) => `${c.name}=${c.value}`).join("; ");
}

async function launch(headless: boolean): Promise<BrowserContext> {
  const base = {
    headless,
    ...(headless ? {} : { viewport: { width: 1024, height: 768 } }),
  };
  try {
    return await chromium.launchPersistentContext(PROFILE_DIR, { ...base, channel: "chrome" });
  } catch {
    try {
      return await chromium.launchPersistentContext(PROFILE_DIR, { ...base, channel: "msedge" });
    } catch {
      throw new AuthFlowError(
        "Couldn't open a browser window — install Google Chrome (or Edge), or paste the cookie manually.",
        400
      );
    }
  }
}

/** Phase 1: reuse cookies already in the profile (invisible, headless).
 *  Phase 2: headed login window → poll for a fresh login → mint tokens. */
export async function autoLoginWithBrowser(): Promise<AuthResult> {
  if (busy) {
    throw new AuthFlowError("A login window is already open — finish there, or wait for it to close.", 409);
  }
  busy = true;
  let ctx: BrowserContext | null = null;
  try {
    // ---- Phase 0: existing session in installed Chrome (no window) ----
    try {
      const harvest = await harvestChromeRiotCookies();
      if ("cookies" in harvest) {
        const header = riotCookieHeader(harvest.cookies);
        if (header) {
          try {
            return await loginWithCookies(header);
          } catch (e) {
            if (!(e instanceof AuthFlowError && e.status === 401)) throw e; // expired → window
          }
        }
      } else {
        console.log(`[auto-login] chrome harvest skipped: ${harvest.skip}`);
      }
    } catch (e) {
      if (e instanceof AuthFlowError && e.status === 403) throw e; // keychain denied → explain
      console.log(`[auto-login] chrome harvest failed: ${e instanceof Error ? e.message : e}`);
    }

    // ---- Phase 1: existing profile session, no window ----
    ctx = await launch(true);
    const existing = riotCookieHeader(await ctx.cookies());
    await ctx.close();
    ctx = null;
    if (existing) {
      try {
        return await loginWithCookies(existing);
      } catch (e) {
        if (!(e instanceof AuthFlowError && e.status === 401)) throw e; // expired → phase 2
      }
    }

    // ---- Phase 2: headed window, wait for a real login ----
    ctx = await launch(false);
    await ctx.clearCookies(); // dedicated profile; force a fresh login
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});

    const deadline = Date.now() + WAIT_MS;
    let last = "";
    let attempts = 0;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 1000));
      const header = riotCookieHeader(await ctx.cookies());
      if (!header || header === last) continue;
      last = header;
      attempts++;
      if (attempts > MAX_ATTEMPTS) {
        throw new AuthFlowError("Too many login attempts this minute — wait a minute and try again.", 429);
      }
      try {
        return await loginWithCookies(header);
      } catch (e) {
        if (e instanceof AuthFlowError && e.status === 401) continue; // partial/old cookie — keep waiting
        throw e;
      }
    }
    throw new AuthFlowError(
      "No Riot login detected in the window within 5 minutes — the window will close; paste the cookie manually instead.",
      408
    );
  } finally {
    busy = false;
    if (ctx) await ctx.close().catch(() => {});
  }
}
