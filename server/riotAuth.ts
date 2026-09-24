// Remote Riot login (email/password + email OTP), server-side.
// Verified against valapidocs.techchrism.me: Auth Cookies / Auth Request /
// Multi-Factor Authentication / Cookie Reauth / Entitlement / Player Info.
// RULES: credentials live only inside one request chain; sessions hold the
// cookie jar for at most 5 minutes; nothing here is ever logged.

const API_AUTHZ = "https://auth.riotgames.com/api/v1/authorization";
const REAUTH_URL =
  "https://auth.riotgames.com/authorize?redirect_uri=https%3A%2F%2Fplayvalorant.com%2Fopt_in" +
  "&client_id=play-valorant-web-prod&response_type=token%20id_token&nonce=1&scope=account%20openid";

const CLIENT_SEED_BODY = {
  acr_values: "urn:riot:bronze",
  claims: "",
  client_id: "riot-client",
  nonce: "oYnVwCSrlS5IHKh7iI16oQ",
  redirect_uri: "http://localhost/redirect",
  response_type: "token id_token",
  scope: "openid link ban lol_region",
};

import { getClientBuild } from "./catalog";
import { captchaSolverEnabled, solveCaptcha } from "./captchaSolver";
import type { Region } from "../src/types";

// Header sets modeled on working community tools (GamerNoTitle/VSC): the
// riot-client flow authenticates with a RiotClient UA — NOT a browser UA —
// and skips the web flow's captcha gate. WEB_HEADERS remain for the cookie
// reauth fallback (play-valorant-web-prod flow).
const WEB_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  Accept: "application/json",
  Origin: "https://playvalorant.com",
  Referer: "https://playvalorant.com/",
};

function clientHeaders(build: string): Record<string, string> {
  return {
    "User-Agent": `RiotClient/${build} riot-status (Windows;10;;Professional, x64)`,
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
  };
}

export class AuthFlowError extends Error {
  constructor(message: string, readonly status = 401, readonly details?: Record<string, unknown>) {
    super(message);
  }
}

export class CookieJar {
  private cookies = new Map<string, string>();

  absorb(h: Headers): void {
    let raw: string[] = [];
    const getSetCookie = (h as unknown as { getSetCookie?: () => string[] }).getSetCookie;
    if (typeof getSetCookie === "function") {
      raw = getSetCookie.call(h);
    } else {
      const one = h.get("set-cookie");
      if (one) raw = one.split(/,(?=\s*[^;=\s]+=)/);
    }
    for (const line of raw) {
      const pair = line.split(";")[0];
      const i = pair.indexOf("=");
      if (i < 0) continue;
      const name = pair.slice(0, i).trim();
      const value = pair.slice(i + 1).trim();
      if (!value) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  header(): string {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  names(): string[] {
    return [...this.cookies.keys()];
  }

  set(name: string, value: string): void {
    this.cookies.set(name, value);
  }

  has(name: string): boolean {
    return this.cookies.has(name);
  }
}

export type AuthPrompt =
  | { kind: "success"; puuid: string | null }
  | { kind: "mfa"; maskedEmail: string }
  | { kind: "error"; message: string };

export function classifyAuthResponse(body: any): AuthPrompt {
  if (body?.type === "success") {
    const puuid = body.success?.puuid;
    return { kind: "success", puuid: typeof puuid === "string" ? puuid : null };
  }
  if (body?.type === "multifactor" || (body && typeof body === "object" && "multifactor" in body)) {
    const m = body.multifactor ?? {};
    if (m.error === "invalid_code") return { kind: "error", message: "Invalid verification code — try again." };
    return { kind: "mfa", maskedEmail: typeof m.email === "string" ? m.email : "" };
  }
  const err = String(body?.error ?? body?.error_description ?? "unknown response").slice(0, 180);
  if (err === "auth_failure") {
    return {
      kind: "error",
      message:
        "Riot rejected the sign-in (auth_failure). Check the email + password you use for VALORANT (not name#tag). " +
        "Accounts that only sign in via Google/Apple cannot use this mode. " +
        "If a captcha is shown below, solve it and try again — otherwise use cookie / AUTO LOGIN." +
        `\n\nRaw response: ${JSON.stringify(body ?? {}).slice(0, 400)}`,
    };
  }
  return {
    kind: "error",
    message: `Riot login was rejected (${err}).` + `\n\nRaw response: ${JSON.stringify(body ?? {}).slice(0, 400)}`,
  };
}

export function parseTokenLocation(location: string): { accessToken: string; idToken: string } | null {
  const hash = location.split("#")[1];
  if (!hash) return null;
  const p = new URLSearchParams(hash);
  const accessToken = p.get("access_token");
  if (!accessToken) return null;
  return { accessToken, idToken: p.get("id_token") ?? "" };
}

export function isLoginRedirect(location: string): boolean {
  return location.includes("authenticate.riotgames.com/login");
}

/** Tokens can arrive inline in the auth response (riot-client flow):
 *  plain `access_token=…` in text, or inside response.parameters.uri. */
export function extractTokens(text: string): { accessToken: string; idToken: string } | null {
  const a = /access_token=([^&\s"'<>]+)/.exec(text);
  if (!a) return null;
  const i = /id_token=([^&\s"'<>]+)/.exec(text);
  return { accessToken: a[1], idToken: i ? i[1] : "" };
}

/** Map riot-geo affinities.live (e.g. "na", "EU") to our Region type. */
export function normalizeRegion(value: unknown): Region | null {
  if (typeof value !== "string") return null;
  const v = value.toLowerCase();
  if (v === "na" || v === "latam" || v === "br" || v === "eu" || v === "ap" || v === "kr") return v;
  if (v === "pbe") return "na";
  return null;
}

/** Forgiving parser for what users paste:
 *  bare value → ssid=<value>;  single pair "ssid=abc";  or multi "ssid=a; asid=b; …".
 *  Normalizes: strips a leading "Cookie:" header, lowercases cookie names,
 *  allows spaces around "=", and strips surrounding quotes on values. */
export function parseCookieInput(raw: string): Array<[string, string]> {
  let input = raw.trim().replace(/^cookie:\s*/i, "");
  if (!input) return [];
  if (!input.includes(";")) {
    // Pair with a known cookie name (any case / spaces around =).
    const m = /^([a-z_][a-z0-9_-]*)\s*=\s*(.*)$/i.exec(input);
    if (m) {
      const name = m[1].toLowerCase();
      const value = m[2].trim().replace(/^"(.*)"$/, "$1");
      if (["ssid", "tdid", "asid", "clid", "ccid", "__cf_bm"].includes(name)) {
        return [[name, value]];
      }
      // Unrecognized single pair: bare ssid values may contain '=' (base64 padding).
      // Only treat as a pair when the name looks like a cookie name AND value is non-empty
      // without another '=' — otherwise fall through to bare-value (legacy behavior for "foo=bar").
      return [["ssid", input.replace(/^"|"$/g, "")]];
    }
    return [["ssid", input.replace(/^"|"$/g, "")]];
  }
  const out: Array<[string, string]> = [];
  for (const part of input.split(";")) {
    const p = part.trim();
    if (!p) continue;
    const i = p.indexOf("=");
    if (i > 0) {
      const name = p.slice(0, i).trim().toLowerCase();
      const value = p
        .slice(i + 1)
        .trim()
        .replace(/^"(.*)"$/, "$1");
      if (name) out.push([name, value]);
    }
  }
  return out;
}

/** Cookie mode: user logs into playvalorant.com themselves (official page —
 *  password/captcha/2FA never touch us), pastes the ssid cookie, we mint
 *  tokens via Riot's own Cookie Reauth endpoint (docs-recommended over
 *  storing passwords; ssid-only refresh stable ~1 week). */
export async function loginWithCookies(raw: string): Promise<AuthResult> {
  const pairs = parseCookieInput(raw);
  if (!pairs.some(([n]) => n === "ssid")) {
    throw new AuthFlowError(
      "Couldn't find an ssid cookie in what you pasted — copy the `ssid` value from auth.riotgames.com cookies (see the how-to).",
      400
    );
  }
  const jar = new CookieJar();
  for (const [n, v] of pairs) jar.set(n, v);
  try {
    return finishLogin(await reauthForTokens(jar), null);
  } catch (e) {
    if (e instanceof AuthFlowError && e.status === 401) {
      throw new AuthFlowError(
        "Riot rejected the cookie — it is probably expired or incomplete. Log in at playvalorant.com again and copy a fresh ssid value." +
          `\n\nDetail: ${e.message}`,
        401
      );
    }
    throw e;
  }
}

// ---- short-lived MFA sessions (cookie jars only, never credentials) ----
export interface AuthSession {
  jar: CookieJar;
  maskedEmail: string;
  puuid: string | null;
  createdAt: number;
}

const SESSIONS = new Map<string, AuthSession>();
const SESSION_TTL_MS = 5 * 60_000;
const MAX_SESSIONS = 200;

function pruneSessions(): void {
  const now = Date.now();
  for (const [id, s] of SESSIONS) if (now - s.createdAt > SESSION_TTL_MS) SESSIONS.delete(id);
}

export function createSession(session: AuthSession): string {
  pruneSessions();
  if (SESSIONS.size >= MAX_SESSIONS) {
    const oldest = SESSIONS.keys().next().value;
    if (oldest) SESSIONS.delete(oldest);
  }
  const id = crypto.randomUUID();
  SESSIONS.set(id, session);
  return id;
}

export function getSession(id: string): AuthSession | null {
  pruneSessions();
  return SESSIONS.get(id) ?? null;
}

export function destroySession(id: string): void {
  SESSIONS.delete(id);
}

// ---- naive per-IP rate limit for login attempts ----
const attempts = new Map<string, number[]>();

export function rateLimit(key: string, limit = 5, windowMs = 60_000): boolean {
  const now = Date.now();
  const arr = (attempts.get(key) ?? []).filter((t) => now - t < windowMs);
  if (arr.length >= limit) {
    attempts.set(key, arr);
    return false;
  }
  arr.push(now);
  attempts.set(key, arr);
  return true;
}

const ENTITLEMENTS_URL = "https://entitlements.auth.riotgames.com/api/token/v1";

export interface AuthResult {
  kind: "tokens";
  accessToken: string;
  entitlementsToken: string;
  puuid: string;
  region: Region | null;
}

function subFromIdToken(idToken: string): string | null {
  try {
    const payload = idToken.split(".")[1];
    if (!payload) return null;
    const json = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return typeof json.sub === "string" ? json.sub : null;
  } catch {
    return null;
  }
}

async function requestEntitlements(accessToken: string): Promise<string> {
  let res: Response;
  try {
    res = await fetch(ENTITLEMENTS_URL, {
      method: "POST",
      headers: { ...WEB_HEADERS, Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new AuthFlowError("Could not reach Riot entitlements service (network).", 502);
  }
  if (!res.ok) {
    throw new AuthFlowError(`Riot entitlements refused the session (HTTP ${res.status}) — try again shortly.`, 403);
  }
  const body = await res.json().catch(() => null);
  const token = body?.entitlements_token;
  if (typeof token !== "string" || !token) throw new AuthFlowError("Entitlements response missing token.", 403);
  return token;
}

async function reauthForTokens(jar: CookieJar): Promise<{ accessToken: string; idToken: string }> {
  if (!jar.has("ssid")) throw new AuthFlowError("Login session cookie missing — please sign in again.", 401);
  let res: Response;
  try {
    res = await fetch(REAUTH_URL, {
      headers: {
        ...WEB_HEADERS,
        // The authorize endpoint is an HTML navigation — a browser-style Accept
        // is required (Accept: application/json → HTTP406, no redirect at all).
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        Cookie: jar.header(),
      },
      redirect: "manual",
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new AuthFlowError("Could not reach Riot auth service (network).", 502);
  }
  jar.absorb(res.headers);
  const location = res.headers.get("location") ?? "";
  const parsed = parseTokenLocation(location);
  if (parsed) return parsed;
  // Failure diagnosis — status/redirect target only, never tokens or cookie values.
  if (isLoginRedirect(location)) {
    throw new AuthFlowError(
      `Riot reauth redirected to the login page (HTTP ${res.status}) — the session cookie was rejected or expired.`,
      401
    );
  }
  if (!location) {
    throw new AuthFlowError(`Riot reauth returned HTTP ${res.status} with no redirect — the request was not accepted.`, 401);
  }
  let target: URL | null = null;
  try {
    target = new URL(location);
  } catch {
    target = null;
  }
  if (!target) throw new AuthFlowError(`Riot reauth returned an unparseable redirect (HTTP ${res.status}).`, 401);
  const oauthErr = target.searchParams.get("error_description") ?? target.searchParams.get("error");
  if (oauthErr) {
    throw new AuthFlowError(`Riot reauth returned an OAuth error (HTTP ${res.status}): ${oauthErr.slice(0, 160)}`, 401);
  }
  throw new AuthFlowError(
    `Riot reauth redirected to ${target.host}${target.pathname} without a token (HTTP ${res.status}).`,
    401
  );
}

interface AuthResponse {
  status: number;
  text: string;
  body: any;
}

async function authRequest(url: string, init: RequestInit, jar: CookieJar): Promise<AuthResponse> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, redirect: "manual", signal: AbortSignal.timeout(15000) });
  } catch {
    throw new AuthFlowError("Could not reach Riot auth service (network).", 502);
  }
  jar.absorb(res.headers);
  const text = await res.text().catch(() => "");
  let body: any = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }
  if (text && body === null && !text.includes("access_token=")) {
    throw new AuthFlowError(
      `Riot returned HTTP ${res.status} non-JSON content — likely an anti-bot page. Use the token-paste option below.`,
      401
    );
  }
  return { status: res.status, text, body };
}

async function finishLogin(tokens: { accessToken: string; idToken: string }, puuid: string | null): Promise<AuthResult> {
  const build = await getClientBuild();
  const headers = clientHeaders(build);

  let entitlementsToken: string;
  try {
    const ent = await fetch(ENTITLEMENTS_URL, {
      method: "POST",
      headers: { ...headers, Authorization: `Bearer ${tokens.accessToken}`, "Content-Type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(15000),
    });
    if (!ent.ok) throw new Error(String(ent.status));
    const body = await ent.json().catch(() => null);
    entitlementsToken = body?.entitlements_token;
    if (typeof entitlementsToken !== "string" || !entitlementsToken) throw new Error("missing");
  } catch {
    throw new AuthFlowError(
      "Riot entitlements step failed — the session may not be fully established yet; try again.",
      403
    );
  }

  // Bonus: auto-detect region affinity from riot-geo (GamerNoTitle/VSC flow)
  let region: Region | null = null;
  try {
    const geo = await fetch("https://riot-geo.pas.si.riotgames.com/pas/v1/product/valorant", {
      method: "PUT",
      headers: { ...headers, Authorization: `Bearer ${tokens.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ id_token: tokens.idToken }),
      signal: AbortSignal.timeout(10000),
    });
    if (geo.ok) {
      const g = await geo.json().catch(() => null);
      region = normalizeRegion(g?.affinities?.live);
    }
  } catch {
    /* keep null → caller falls back to the user-selected region */
  }

  return {
    kind: "tokens",
    accessToken: tokens.accessToken,
    entitlementsToken,
    puuid: puuid ?? subFromIdToken(tokens.idToken) ?? "",
    region,
  };
}

export interface StartLoginInput {
  username: string;
  password: string;
  captcha?: string;
  /** Server-side challenge session (cookie jar + rqdata binding). Required with captcha. */
  captchaSessionId?: string;
}

export interface CaptchaChallenge {
  sitekey: string;
  rqdata: string | null;
  captchaSessionId?: string;
}

const API_AUTHN = "https://authenticate.riotgames.com/api/v1/login";
const API_LOGIN_TOKEN = "https://auth.riotgames.com/api/v1/login-token";
const STATIC_SITEKEY = "019f1553-3845-481c-a6f5-5a60ccf6d830";

/** Captcha sessions hold the cookie jar from the challenge POST so the
 *  subsequent PUT (hcaptcha token) shares tdid / authenticator.sid / __cflb. */
interface CaptchaSession {
  jar: CookieJar;
  sitekey: string;
  rqdata: string;
  createdAt: number;
}

const CAPTCHA_SESSIONS = new Map<string, CaptchaSession>();
const CAPTCHA_TTL_MS = 5 * 60_000;
const MAX_CAPTCHA_SESSIONS = 100;

function pruneCaptchaSessions(): void {
  const now = Date.now();
  for (const [id, s] of CAPTCHA_SESSIONS) if (now - s.createdAt > CAPTCHA_TTL_MS) CAPTCHA_SESSIONS.delete(id);
}

function saveCaptchaSession(jar: CookieJar, sitekey: string, rqdata: string): string {
  pruneCaptchaSessions();
  if (CAPTCHA_SESSIONS.size >= MAX_CAPTCHA_SESSIONS) {
    const oldest = CAPTCHA_SESSIONS.keys().next().value;
    if (oldest) CAPTCHA_SESSIONS.delete(oldest);
  }
  const id = crypto.randomUUID();
  CAPTCHA_SESSIONS.set(id, { jar, sitekey, rqdata, createdAt: Date.now() });
  return id;
}

function getCaptchaSession(id: string): CaptchaSession | null {
  pruneCaptchaSessions();
  return CAPTCHA_SESSIONS.get(id) ?? null;
}

function deleteCaptchaSession(id: string): void {
  CAPTCHA_SESSIONS.delete(id);
}

function authenticatorHeaders(build: string, cookie?: string): Record<string, string> {
  const h: Record<string, string> = {
    "User-Agent": `RiotClient/${build} rso-authenticator (Windows;10;;Professional, x64)`,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  if (cookie) h.Cookie = cookie;
  return h;
}

async function seedAuthorization(jar: CookieJar, build: string): Promise<void> {
  const body = JSON.stringify({
    ...CLIENT_SEED_BODY,
    nonce: crypto.randomUUID().replace(/-/g, "").slice(0, 21),
  });
  const init = {
    method: "POST",
    headers: { ...clientHeaders(build), "Content-Type": "application/json" },
    body,
  };
  await authRequest(API_AUTHZ, init, jar);
  // rogama25: re-send once if asid is missing
  if (!jar.has("asid")) {
    await authRequest(
      API_AUTHZ,
      {
        ...init,
        body: JSON.stringify({ ...CLIENT_SEED_BODY, nonce: crypto.randomUUID().replace(/-/g, "").slice(0, 21) }),
      },
      jar
    );
  }
}

function challengeFromBody(body: any): { sitekey: string; rqdata: string } | null {
  const hc = body?.captcha?.hcaptcha;
  if (typeof hc?.key === "string" && hc.key) {
    return { sitekey: hc.key, rqdata: typeof hc.data === "string" && hc.data ? hc.data : "" };
  }
  return null;
}

async function postAuthenticateChallenge(jar: CookieJar, build: string): Promise<{ sitekey: string; rqdata: string } | null> {
  const res = await authRequest(
    API_AUTHN,
    {
      method: "POST",
      headers: authenticatorHeaders(build, jar.header()),
      body: JSON.stringify({
        apple: null,
        campaign: null,
        clientId: "riot-client",
        code: null,
        facebook: null,
        gamecenter: null,
        google: null,
        language: "",
        multifactor: null,
        nintendo: null,
        platform: "windows",
        playstation: null,
        remember: false,
        riot_identity: {
          campaign: null,
          captcha: null,
          language: "en_US",
          password: null,
          remember: null,
          state: "auth",
          username: null,
        },
        riot_identity_signup: null,
        rso: null,
        sdkVersion: String((await getClientBuild()).split(".")[0] ?? "0") + ".0.0",
        type: "auth",
        xbox: null,
      }),
    },
    jar
  );
  return challengeFromBody(res.body);
}

/** Fresh seed + authenticate challenge → short-lived session the UI must echo back with the captcha token. */
export async function requestCaptchaChallenge(): Promise<CaptchaChallenge> {
  const build = await getClientBuild();
  const jar = new CookieJar();
  await seedAuthorization(jar, build);
  const challenge = await postAuthenticateChallenge(jar, build);
  if (challenge) {
    const captchaSessionId = saveCaptchaSession(jar, challenge.sitekey, challenge.rqdata);
    return { sitekey: challenge.sitekey, rqdata: challenge.rqdata || null, captchaSessionId };
  }
  return { sitekey: STATIC_SITEKEY, rqdata: null };
}

function challengeError(
  message: string,
  jar: CookieJar | null,
  extra: Record<string, unknown> = {}
): AuthFlowError {
  // Best-effort: mint a fresh challenge for the UI when we still can.
  return new AuthFlowError(message, 401, {
    captchaRequired: true,
    sitekey: STATIC_SITEKEY,
    rqdata: null,
    ...extra,
    ...(jar ? {} : {}),
  });
}

async function beginChallenge(build: string): Promise<{ jar: CookieJar; challenge: CaptchaChallenge }> {
  const jar = new CookieJar();
  await seedAuthorization(jar, build);
  const ch = await postAuthenticateChallenge(jar, build);
  if (!ch) {
    throw new AuthFlowError(
      "Riot did not issue a captcha challenge — try again, or use cookie / AUTO LOGIN.",
      401,
      { captchaRequired: true, sitekey: STATIC_SITEKEY, rqdata: null }
    );
  }
  const captchaSessionId = saveCaptchaSession(jar, ch.sitekey, ch.rqdata);
  return {
    jar,
    challenge: { sitekey: ch.sitekey, rqdata: ch.rqdata || null, captchaSessionId },
  };
}

/** PUT credentials + `hcaptcha <token>` to authenticate.riotgames.com (live 2026 flow). */
async function putAuthenticateLogin(
  jar: CookieJar,
  build: string,
  input: StartLoginInput
): Promise<AuthResponse> {
  return authRequest(
    API_AUTHN,
    {
      method: "PUT",
      headers: authenticatorHeaders(build, jar.header()),
      body: JSON.stringify({
        type: "auth",
        riot_identity: {
          campaign: null,
          captcha: `hcaptcha ${input.captcha ?? ""}`,
          language: "en_US",
          password: input.password,
          remember: false,
          state: null,
          username: input.username,
        },
      }),
    },
    jar
  );
}

/** Shared success/error handling after a password PUT against a challenge jar. */
async function afterAuthenticatePut(
  jar: CookieJar,
  build: string,
  input: StartLoginInput,
  put: AuthResponse,
  cookieNamesHint: (j: CookieJar) => string
): Promise<{ kind: "mfa"; sessionId: string; maskedEmail: string } | AuthResult> {
  const mfaPrompt = classifyAuthResponse(put.body);
  if (mfaPrompt.kind === "mfa") {
    const sessionId = createSession({ jar, maskedEmail: mfaPrompt.maskedEmail, puuid: null, createdAt: Date.now() });
    return { kind: "mfa", sessionId, maskedEmail: mfaPrompt.maskedEmail };
  }

  const loginToken = put.body?.success?.login_token;
  if (typeof loginToken === "string" && loginToken) {
    await exchangeLoginToken(jar, build, loginToken);
    return finishLogin(await tokensFromAuthorization(jar, build), null);
  }

  const errBody = put.body ?? {};
  const errCode = String(errBody.error ?? errBody.error_description ?? "").slice(0, 120);
  const isCaptchaIssue =
    put.status === 400 ||
    /captcha|invalid_request/i.test(errCode) ||
    (errBody.captcha != null && !loginToken);

  const fresh = await beginChallenge(build);
  const cookies = cookieNamesHint(jar);
  if (isCaptchaIssue) {
    throw new AuthFlowError(
      "Riot rejected the captcha token (expired, already used, or wrong challenge). Solve the new captcha and try again." +
        `\n\nRaw: ${JSON.stringify(errBody).slice(0, 300)} [session cookies: ${cookies}]`,
      401,
      {
        captchaRequired: true,
        sitekey: fresh.challenge.sitekey,
        rqdata: fresh.challenge.rqdata,
        captchaSessionId: fresh.challenge.captchaSessionId,
        cookieNames: cookies,
      }
    );
  }
  if (mfaPrompt.kind === "error") {
    throw new AuthFlowError(`${mfaPrompt.message} [session cookies: ${cookies}]`, 401, {
      captchaRequired: true,
      sitekey: fresh.challenge.sitekey,
      rqdata: fresh.challenge.rqdata,
      captchaSessionId: fresh.challenge.captchaSessionId,
      cookieNames: cookies,
    });
  }
  throw new AuthFlowError(
    `Riot login failed (${errCode || put.status}). Try again or use cookie / AUTO LOGIN.\n\nRaw: ${JSON.stringify(errBody).slice(0, 300)}`,
    401,
    {
      captchaRequired: true,
      sitekey: fresh.challenge.sitekey,
      rqdata: fresh.challenge.rqdata,
      captchaSessionId: fresh.challenge.captchaSessionId,
      cookieNames: cookies,
    }
  );
}

async function exchangeLoginToken(jar: CookieJar, build: string, loginToken: string): Promise<void> {
  await authRequest(
    API_LOGIN_TOKEN,
    {
      method: "POST",
      headers: { ...clientHeaders(build), "Content-Type": "application/json", Cookie: jar.header() },
      body: JSON.stringify({
        authentication_type: "RiotAuth",
        code_verifier: "",
        login_token: loginToken,
        persist_login: false,
      }),
    },
    jar
  );
  if (!jar.has("ssid")) {
    throw new AuthFlowError("Riot login-token exchange did not return a session cookie — try again.", 401);
  }
}

async function tokensFromAuthorization(jar: CookieJar, build: string): Promise<{ accessToken: string; idToken: string }> {
  const res = await authRequest(
    API_AUTHZ,
    {
      method: "POST",
      headers: { ...clientHeaders(build), "Content-Type": "application/json", Cookie: jar.header() },
      body: JSON.stringify({
        ...CLIENT_SEED_BODY,
        nonce: crypto.randomUUID().replace(/-/g, "").slice(0, 21),
      }),
    },
    jar
  );
  const direct = extractTokens(res.text);
  if (direct) return direct;
  return reauthForTokens(jar);
}

function throwCaptchaChallenge(message: string, build: string, oldSessionId?: string): never {
  if (oldSessionId) deleteCaptchaSession(oldSessionId);
  // Fire-and-forget is wrong (need the session id) — caller should await beginChallenge.
  throw new AuthFlowError(message, 401, {
    captchaRequired: true,
    sitekey: STATIC_SITEKEY,
    rqdata: null,
    ...(oldSessionId ? { previousSessionId: oldSessionId } : {}),
  });
}

export async function startLogin(
  input: StartLoginInput
): Promise<{ kind: "mfa"; sessionId: string; maskedEmail: string } | AuthResult> {
  const build = await getClientBuild();
  const cookieNamesHint = (jar: CookieJar) => jar.names().join(",") || "none";

  // ---- path A: client solved captcha against a prior challenge session ----
  if (input.captcha && input.captchaSessionId) {
    const sess = getCaptchaSession(input.captchaSessionId);
    if (!sess) {
      const fresh = await beginChallenge(build);
      throw new AuthFlowError(
        "Captcha session expired — solve the new captcha and try again.",
        401,
        {
          captchaRequired: true,
          sitekey: fresh.challenge.sitekey,
          rqdata: fresh.challenge.rqdata,
          captchaSessionId: fresh.challenge.captchaSessionId,
          cookieNames: cookieNamesHint(fresh.jar),
        }
      );
    }
    const jar = sess.jar;
    deleteCaptchaSession(input.captchaSessionId);
    const put = await putAuthenticateLogin(jar, build, input);
    return afterAuthenticatePut(jar, build, input, put, cookieNamesHint);
  }

  // ---- path B: first attempt ----
  // Hosted sites cannot mint Riot-accepted hcaptcha tokens (host-locked to
  // authenticate.riotgames.com). When CAPMONSTER_API_KEY is set, solve
  // server-side for that origin and complete the password PUT in one request.
  const fresh = await beginChallenge(build);
  if (captchaSolverEnabled()) {
    const token = await solveCaptcha(fresh.challenge.rqdata);
    if (token) {
      const put = await putAuthenticateLogin(fresh.jar, build, { ...input, captcha: token });
      return afterAuthenticatePut(fresh.jar, build, input, put, cookieNamesHint);
    }
    throw new AuthFlowError(
      "Captcha solver failed — try again, or use AUTO LOGIN / cookie paste.",
      502,
      {
        captchaRequired: true,
        sitekey: fresh.challenge.sitekey,
        rqdata: fresh.challenge.rqdata,
        captchaSessionId: fresh.challenge.captchaSessionId,
        cookieNames: cookieNamesHint(fresh.jar),
      }
    );
  }

  throw new AuthFlowError(
    "Solve the captcha below, then sign in again with your email + password." +
      " On the hosted site the widget token may be rejected (host-lock) — use AUTO LOGIN or cookie paste, or set CAPMONSTER_API_KEY.",
    401,
    {
      captchaRequired: true,
      sitekey: fresh.challenge.sitekey,
      rqdata: fresh.challenge.rqdata,
      captchaSessionId: fresh.challenge.captchaSessionId,
      cookieNames: cookieNamesHint(fresh.jar),
    }
  );
}

export async function submitMfa(sessionId: string, otp: string): Promise<AuthResult> {
  const session = getSession(sessionId);
  if (!session) throw new AuthFlowError("Sign-in session expired — please sign in again.", 400);
  const build = await getClientBuild();
  const headers = clientHeaders(build);

  const res = await authRequest(
    API_AUTHZ,
    {
      method: "PUT",
      headers: { ...headers, "Content-Type": "application/json", Cookie: session.jar.header() },
      body: JSON.stringify({ type: "multifactor", code: otp, rememberDevice: true }),
    },
    session.jar
  );

  const direct = extractTokens(res.text);
  if (direct) {
    const result = await finishLogin(direct, null);
    destroySession(sessionId);
    return result;
  }

  const prompt = classifyAuthResponse(res.body);
  if (prompt.kind === "error") throw new AuthFlowError(prompt.message, 401); // invalid code → session kept for retry
  if (prompt.kind === "mfa") throw new AuthFlowError("Riot still expects a verification code.", 401);

  const result = await finishLogin(await reauthForTokens(session.jar), prompt.puuid);
  destroySession(sessionId);
  return result;
}

