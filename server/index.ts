import express from "express";
import path from "node:path";
import fs from "node:fs";
import { buildShowcase, UpstreamError } from "./valorant";
import type { Region } from "../src/types";
import { getRsoConfig, buildAuthorizeUrl, handleRsoExchange } from "./rso";
import { startLogin, submitMfa, rateLimit, AuthFlowError, loginWithCookies, normalizeRegion, requestCaptchaChallenge, parseCookieInput, detectRegion, requestEntitlements, subFromIdToken } from "./riotAuth";
import { extractAccessUrl } from "./accessUrl";
import { autoLoginWithBrowser } from "./browserLogin";
import { captchaSolverEnabled } from "./captchaSolver";
import { getCatalog } from "./catalog";
import { verifyManifest, ManifestError } from "./shareManifest";
import {
  buildSnapshot,
  createPgShareStore,
  injectShareMeta,
  MemoryShareStore,
  newShareId,
  parsePicks,
  parsePreview,
  ShareError,
  SHARE_ID_RE,
  type ShareStore,
} from "./share";

try {
  (process as any).loadEnvFile?.();
} catch {
  /* .env is optional */
}

const app = express();
const PORT = Number(process.env.PORT ?? 3001);
// Behind the Dokploy/Traefik reverse proxy: trust exactly one hop so `req.ip`
// becomes the real client instead of the shared proxy socket — otherwise every
// visitor shares one rate-limit bucket. With no XFF header (direct/local call)
// the socket address is used, so spoofing isn't possible on the local path.
app.set("trust proxy", 1);
const smallJson = express.json({ limit: "32kb" });
// Share creation carries the signed ownership proof plus a JPEG preview.
const shareJson = express.json({ limit: "1mb" });
app.use((req, res, next) => (req.path === "/api/share" ? shareJson : smallJson)(req, res, next));

let shareStore: ShareStore | null = null;
/** Why sharing is off, as a fixed code (never the raw error, which can echo the host). */
let shareStatus: "ready" | "not_configured" | "db_unreachable" = "not_configured";
const shareReady = (async () => {
  const url = process.env.DATABASE_URL?.trim();
  if (url) {
    try {
      shareStore = await createPgShareStore(url);
      console.log("[share] postgres store ready");
    } catch (e) {
      shareStatus = "db_unreachable";
      console.error("[share] postgres unavailable, share links disabled:", e instanceof Error ? e.message : e);
    }
  } else if (process.env.NODE_ENV !== "production") {
    shareStore = new MemoryShareStore();
    console.log("[share] DATABASE_URL not set: share links live in memory (dev only)");
  }
  if (shareStore) {
    shareStatus = "ready";
    const store = shareStore;
    setInterval(() => void store.purgeExpired().catch(() => undefined), 60 * 60 * 1000).unref();
  }
})();

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, at: new Date().toISOString() });
});

// One-paste sign-in: user pastes the Riot redirect URL (#access_token=…) —
// the server mints entitlements + resolves region/PUUID from it (never stored).
app.post("/api/account/access-url", async (req, res) => {
  const { url, region } = req.body ?? {};
  if (!rateLimit(`account:${req.ip}`, 10, 60_000)) {
    res.status(429).json({ error: "Too many requests — wait a minute and try again." });
    return;
  }
  try {
    const { accessToken, idToken } = extractAccessUrl(url);
    const entitlementsToken = await requestEntitlements(accessToken);
    const detected = await detectRegion(accessToken, idToken);
    const resolved = detected ?? normalizeRegion(region) ?? "na";
    const payload = await buildShowcase({
      region: resolved,
      accessToken,
      entitlementsToken,
      puuid: subFromIdToken(idToken || accessToken) ?? undefined,
    });
    res.json(payload);
  } catch (e) {
    if (e instanceof AuthFlowError) {
      res.status(e.status).json({ error: e.message });
      return;
    }
    if (e instanceof UpstreamError) {
      res.status(e.httpStatus).json({ error: e.message });
      return;
    }
    console.error("[api/account/access-url] internal error:", e instanceof Error ? e.message : e);
    res.status(500).json({ error: "Internal error while building the showcase." });
  }
});

app.post("/api/account", async (req, res) => {
  const { region, accessToken, entitlementsToken, puuid } = req.body ?? {};
  if (!rateLimit(`account:${req.ip}`, 10, 60_000)) {
    res.status(429).json({ error: "Too many requests — wait a minute and try again." });
    return;
  }
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
const IMG_MAX_BYTES = 8 * 1024 * 1024;
const IMG_CONTENT_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml"]);
const IMG_MAX_REDIRECTS = 3;

/**
 * Fetch an allowlisted asset, following redirects one hop at a time and
 * re-validating every hop — a default `redirect: "follow"` on user-supplied
 * input can walk an allowlisted host off-allowlist.
 */
async function fetchAllowlisted(start: URL): Promise<Response> {
  let target = start;
  for (let hops = 0; ; hops++) {
    const res = await fetch(target, { redirect: "manual", signal: AbortSignal.timeout(15000) });
    if (res.status < 300 || res.status >= 400) return res;
    const loc = res.headers.get("location");
    if (!loc || hops >= IMG_MAX_REDIRECTS) return res;
    let next: URL;
    try {
      next = new URL(loc, target);
    } catch {
      return res;
    }
    if (next.protocol !== "https:" || !IMG_HOST_ALLOWLIST.has(next.hostname)) return res;
    target = next;
  }
}

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
    const upstream = await fetchAllowlisted(target);
    if (!upstream.ok) {
      res.status(502).end();
      return;
    }
    const declared = (upstream.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (!IMG_CONTENT_TYPES.has(declared)) {
      res.status(415).end();
      return;
    }
    const len = Number(upstream.headers.get("content-length") ?? 0);
    if (len > IMG_MAX_BYTES) {
      res.status(413).end();
      return;
    }
    const buf = Buffer.from(await upstream.arrayBuffer());
    if (buf.byteLength > IMG_MAX_BYTES) {
      res.status(413).end();
      return;
    }
    res.setHeader("Content-Type", declared);
    res.setHeader("X-Content-Type-Options", "nosniff");
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
  // Each unauthenticated hit costs 2–3 outbound Riot calls, so it needs the
  // same throttling as the login itself.
  if (!rateLimit(`captcha:${_req.ip}`, 10, 60_000)) {
    res.status(429).json({ error: "Too many captcha requests — wait a minute and try again." });
    return;
  }
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
  // Separate bucket: a wrong password must not consume the OTP retry quota.
  if (!rateLimit(`mfa:${req.ip}`)) {
    res.status(429).json({ error: "Too many verification attempts — wait a minute and try again." });
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
    // Local Chrome harvest/window (dev/desktop). On a headless VPS this errors explicitly.
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
  // Validate ssid before the rate limit so bad pastes never burn quota.
  const pairs = parseCookieInput(cookies);
  if (!pairs.some(([n]) => n === "ssid")) {
    res.status(400).json({
      error: "Couldn't find an ssid cookie in what you pasted — copy the ssid value from auth.riotgames.com cookies (see the how-to).",
    });
    return;
  }
  // Separate bucket: cookie pastes are cheap/local and shouldn't share password quota.
  if (!rateLimit(`cookies:${req.ip}`, 10, 60_000)) {
    res.status(429).json({ error: "Too many cookie attempts — wait a minute and try again." });
    return;
  }
  try {
    const out = await loginWithCookies(cookies);
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

app.get("/api/share/config", async (_req, res) => {
  await shareReady;
  res.json({ enabled: !!shareStore, status: shareStatus });
});

app.post("/api/share", async (req, res) => {
  await shareReady;
  if (!shareStore) {
    res.status(503).json({ error: "Share links aren't available on this server." });
    return;
  }
  if (!rateLimit(`share:${req.ip}`, 10, 10 * 60_000)) {
    res.status(429).json({ error: "Too many links created — wait a few minutes and try again." });
    return;
  }
  try {
    const { proof, picks, preview } = req.body ?? {};
    const manifest = verifyManifest(proof);
    const snapshot = buildSnapshot(manifest, parsePicks(picks), await getCatalog());
    const image = parsePreview(preview);
    let id = newShareId();
    try {
      await shareStore.create(id, snapshot, image);
    } catch {
      id = newShareId();
      await shareStore.create(id, snapshot, image);
    }
    res.json({ id, path: `/s/${id}`, expiresAt: snapshot.expiresAt });
  } catch (e) {
    if (e instanceof ManifestError) {
      res.status(401).json({ error: e.message });
      return;
    }
    if (e instanceof ShareError) {
      res.status(e.status).json({ error: e.message });
      return;
    }
    console.error("[api/share] internal error:", e instanceof Error ? e.message : e);
    res.status(500).json({ error: "Couldn't create the link. Try again." });
  }
});

app.get("/api/share/:id", async (req, res) => {
  await shareReady;
  const missing = () => res.status(404).json({ error: "This link has expired or doesn't exist." });
  if (!shareStore || !SHARE_ID_RE.test(req.params.id)) return void missing();
  try {
    const share = await shareStore.get(req.params.id);
    if (!share) return void missing();
    res.setHeader("Cache-Control", "public, max-age=300");
    res.json(share);
  } catch (e) {
    console.error("[api/share/:id] internal error:", e instanceof Error ? e.message : e);
    res.status(500).json({ error: "Couldn't load this showcase. Try again." });
  }
});

app.get("/s/:id/preview.jpg", async (req, res) => {
  await shareReady;
  if (!shareStore || !SHARE_ID_RE.test(req.params.id)) return void res.status(404).end();
  try {
    const buf = await shareStore.preview(req.params.id);
    if (!buf) return void res.status(404).end();
    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.send(buf);
  } catch {
    res.status(500).end();
  }
});

const distDir = path.resolve(process.cwd(), "dist");
if (fs.existsSync(distDir)) {
  const indexHtml = fs.readFileSync(path.join(distDir, "index.html"), "utf8");
  // Link previews (Discord, X, iMessage) read the HTML only, so share pages
  // get their Open Graph tags server-side.
  app.get("/s/:id", async (req, res) => {
    await shareReady;
    let html = indexHtml;
    if (shareStore && SHARE_ID_RE.test(req.params.id)) {
      try {
        const share = await shareStore.get(req.params.id);
        if (share) {
          const origin = process.env.PUBLIC_URL?.replace(/\/+$/, "") || `${req.protocol}://${req.get("host")}`;
          const hasPreview = !!(await shareStore.preview(req.params.id));
          html = injectShareMeta(indexHtml, share, origin, req.params.id, hasPreview);
        }
      } catch {
        /* fall back to the plain SPA shell */
      }
    }
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  });
  app.use(express.static(distDir));
  app.get("*", (_req, res) => res.sendFile(path.join(distDir, "index.html")));
}

app.listen(PORT, "0.0.0.0", () => {
  console.log(`[valorant-store] api listening on http://0.0.0.0:${PORT}`);
});
