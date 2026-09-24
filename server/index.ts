import express from "express";
import path from "node:path";
import fs from "node:fs";
import { buildShowcase, UpstreamError } from "./valorant";
import type { Region } from "../src/types";
import { getRsoConfig, buildAuthorizeUrl, handleRsoExchange } from "./rso";
import { startLogin, submitMfa, rateLimit, AuthFlowError, loginWithCookies, normalizeRegion, requestCaptchaChallenge } from "./riotAuth";
import { autoLoginWithBrowser } from "./browserLogin";
import {
  startRemoteBrowser,
  status as remoteStatus,
  takeResult as remoteTakeResult,
  latestFrame as remoteLatestFrame,
  sendInput as remoteSendInput,
  stopRemoteBrowser,
  type RemoteInput,
} from "./remoteBrowser";
import { captchaSolverEnabled } from "./captchaSolver";

try {
  (process as any).loadEnvFile?.();
} catch {
  /* .env is optional */
}

const app = express();
const PORT = Number(process.env.PORT ?? 3001);
app.use(express.json({ limit: "32kb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, at: new Date().toISOString() });
});

app.post("/api/account", async (req, res) => {
  const { region, accessToken, entitlementsToken, puuid } = req.body ?? {};
  if (typeof accessToken !== "string" || !accessToken.trim() || typeof entitlementsToken !== "string" || !entitlementsToken.trim()) {
    res.status(400).json({ error: "Both access token and entitlements token are required." });
    return;
  }
  try {
    const payload = await buildShowcase({
      region: region as Region,
      accessToken: accessToken.trim(),
      entitlementsToken: entitlementsToken.trim(),
      puuid: typeof puuid === "string" && puuid.trim() ? puuid.trim() : undefined,
    });
    res.json(payload);
  } catch (e) {
    if (e instanceof UpstreamError) {
      res.status(e.httpStatus).json({ error: e.message });
      return;
    }
    console.error("[api/account] internal error:", e instanceof Error ? e.message : e);
    res.status(500).json({ error: "Internal error while building the showcase." });
  }
});

const IMG_HOST_ALLOWLIST = new Set(["media.valorant-api.com"]);

app.get("/img/:encoded", async (req, res) => {
  let target: URL;
  try {
    target = new URL(decodeURIComponent(req.params.encoded));
  } catch {
    res.status(400).end();
    return;
  }
  if (target.protocol !== "https:" || !IMG_HOST_ALLOWLIST.has(target.hostname)) {
    res.status(403).end();
    return;
  }
  try {
    const upstream = await fetch(target, { signal: AbortSignal.timeout(15000) });
    if (!upstream.ok) {
      res.status(502).end();
      return;
    }
    const type = upstream.headers.get("content-type") ?? "image/png";
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.setHeader("Content-Type", type);
    res.setHeader("Cache-Control", "public, max-age=604800, immutable");
    res.send(buf);
  } catch {
    res.status(502).end();
  }
});

app.get("/api/rso/config", (req, res) => {
  const cfg = getRsoConfig();
  if (!cfg) {
    res.json({ configured: false });
    return;
  }
  const state = typeof req.query.state === "string" ? req.query.state : "";
  res.json({ configured: true, url: state ? buildAuthorizeUrl(cfg, state) : null, redirectUri: cfg.redirectUri });
});

app.post("/api/rso/exchange", async (req, res) => {
  const { code, region } = req.body ?? {};
  if (typeof code !== "string" || !code.trim()) {
    res.status(400).json({ error: "Missing authorization code." });
    return;
  }
  try {
    const payload = await handleRsoExchange(code.trim(), (region as Region) ?? "na");
    res.json(payload);
  } catch (e) {
    if (e instanceof UpstreamError) {
      res.status(e.httpStatus).json({ error: e.message });
      return;
    }
    console.error("[rso/exchange] internal error:", e instanceof Error ? e.message : e);
    res.status(500).json({ error: "Internal error during Riot sign-in." });
  }
});

function respondAuthError(res: import("express").Response, e: unknown): void {
  if (e instanceof AuthFlowError) {
    res.status(e.status).json({ error: e.message, ...(e.details ?? {}) });
    return;
  }
  if (e instanceof UpstreamError) {
    res.status(e.httpStatus).json({ error: e.message });
    return;
  }
  console.error("[auth] internal error:", e instanceof Error ? e.message : e);
  res.status(500).json({ error: "Internal error during sign-in." });
}

app.get("/api/login/captcha-challenge", async (_req, res) => {
  try {
    const challenge = await requestCaptchaChallenge();
    res.json({
      ...(challenge ?? { sitekey: "019f1553-3845-481c-a6f5-5a60ccf6d830", rqdata: null }),
      solver: captchaSolverEnabled(),
    });
  } catch {
    res.json({ sitekey: "019f1553-3845-481c-a6f5-5a60ccf6d830", rqdata: null, solver: captchaSolverEnabled() });
  }
});

// ---- remote browser (hosted AUTO LOGIN) ----
app.post("/api/browser/start", async (req, res) => {
  const { region } = req.body ?? {};
  // Reattaching to a live session must not burn the rate limit (page reload / retry).
  const existing = remoteStatus();
  if (!existing.active) {
    if (!rateLimit(`browser:${req.ip}`, 8, 60_000)) {
      res.status(429).json({ error: "Too many browser attempts — wait a minute." });
      return;
    }
  }
  try {
    const st = await startRemoteBrowser(normalizeRegion(region) ?? "na");
    res.json(st);
  } catch (e) {
    respondAuthError(res, e);
  }
});

app.get("/api/browser/status", (_req, res) => {
  res.json(remoteStatus());
});

app.get("/api/browser/frame", (_req, res) => {
  const buf = remoteLatestFrame();
  if (!buf) {
    res.status(404).json({ error: "No frame yet." });
    return;
  }
  res.setHeader("Content-Type", "image/jpeg");
  res.setHeader("Cache-Control", "no-store");
  res.send(buf);
});

app.post("/api/browser/input", async (req, res) => {
  const input = req.body as RemoteInput | undefined;
  if (!input || typeof input.type !== "string") {
    res.status(400).json({ error: "Input payload required." });
    return;
  }
  try {
    await remoteSendInput(input);
    res.json({ ok: true });
  } catch (e) {
    respondAuthError(res, e);
  }
});

app.get("/api/browser/result", (_req, res) => {
  const result = remoteTakeResult();
  if (!result) {
    res.status(404).json({ error: "Not ready." });
    return;
  }
  res.json(result);
});

app.post("/api/browser/stop", async (_req, res) => {
  await stopRemoteBrowser();
  res.json({ ok: true });
});

app.post("/api/login", async (req, res) => {
  const { username, password, captcha, captchaSessionId, region } = req.body ?? {};
  if (typeof username !== "string" || !username.trim() || typeof password !== "string" || !password) {
    res.status(400).json({ error: "Riot email and password are required." });
    return;
  }
  if (!rateLimit(`login:${req.ip}`)) {
    res.status(429).json({ error: "Too many sign-in attempts — wait a minute and try again." });
    return;
  }
  try {
    const out = await startLogin({
      username: username.trim(),
      password,
      captcha: typeof captcha === "string" && captcha ? captcha : undefined,
      captchaSessionId:
        typeof captchaSessionId === "string" && captchaSessionId ? captchaSessionId : undefined,
    });
    if (out.kind === "mfa") {
      res.json({ mfaRequired: true, sessionId: out.sessionId, email: out.maskedEmail });
      return;
    }
    res.json(
      await buildShowcase({
        region: out.region ?? region ?? "na",
        accessToken: out.accessToken,
        entitlementsToken: out.entitlementsToken,
        puuid: out.puuid || undefined,
      })
    );
  } catch (e) {
    respondAuthError(res, e);
  }
});

app.post("/api/login/mfa", async (req, res) => {
  const { sessionId, code, region } = req.body ?? {};
  if (typeof sessionId !== "string" || !sessionId || typeof code !== "string" || !code.trim()) {
    res.status(400).json({ error: "Verification code is required." });
    return;
  }
  if (!rateLimit(`login:${req.ip}`)) {
    res.status(429).json({ error: "Too many sign-in attempts — wait a minute and try again." });
    return;
  }
  try {
    const out = await submitMfa(sessionId, code.trim());
    res.json(
      await buildShowcase({
        region: out.region ?? region ?? "na",
        accessToken: out.accessToken,
        entitlementsToken: out.entitlementsToken,
        puuid: out.puuid || undefined,
      })
    );
  } catch (e) {
    respondAuthError(res, e);
  }
});

app.post("/api/login/auto", async (req, res) => {
  const { region } = req.body ?? {};
  if (!rateLimit(`login:${req.ip}`)) {
    res.status(429).json({ error: "Too many attempts — wait a minute and try again." });
    return;
  }
  try {
    // Prefer local Chrome harvest/window when a GUI browser exists (dev/desktop).
    // On headless VPS, fall back is an explicit error — UI uses /api/browser/* instead.
    const out = await autoLoginWithBrowser();
    res.json(
      await buildShowcase({
        region: out.region ?? normalizeRegion(region) ?? "na",
        accessToken: out.accessToken,
        entitlementsToken: out.entitlementsToken,
        puuid: out.puuid || undefined,
      })
    );
  } catch (e) {
    respondAuthError(res, e);
  }
});

app.post("/api/login/cookies", async (req, res) => {
  const { cookies, region } = req.body ?? {};
  if (typeof cookies !== "string" || !cookies.trim()) {
    res.status(400).json({ error: "Paste your ssid cookie value (see the how-to)." });
    return;
  }
  if (!rateLimit(`login:${req.ip}`)) {
    res.status(429).json({ error: "Too many attempts — wait a minute and try again." });
    return;
  }
  try {
    const out = await loginWithCookies(cookies);
    res.json(
      await buildShowcase({
        region: out.region ?? region ?? "na",
        accessToken: out.accessToken,
        entitlementsToken: out.entitlementsToken,
        puuid: out.puuid || undefined,
      })
    );
  } catch (e) {
    respondAuthError(res, e);
  }
});

const distDir = path.resolve(process.cwd(), "dist");
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get("*", (_req, res) => res.sendFile(path.join(distDir, "index.html")));
}

app.listen(PORT, "0.0.0.0", () => {
  console.log(`[valorant-store] api listening on http://0.0.0.0:${PORT}`);
});
