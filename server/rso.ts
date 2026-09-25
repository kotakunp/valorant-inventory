import { buildShowcase, UpstreamError } from "./valorant";
import { detectRegion } from "./riotAuth";
import type { ShowcasePayload, Region } from "../src/types";

const AUTHORIZE_URL = "https://auth.riotgames.com/authorize";
const TOKEN_URL = "https://auth.riotgames.com/oauth2/token";
const USERINFO_URL = "https://auth.riotgames.com/userinfo";
const ENTITLEMENTS_URL = "https://entitlements.auth.riotgames.com/api/token/v1";

export interface RsoConfig {
  clientId: string;
  redirectUri: string;
  clientSecret: string | null;
}

export function getRsoConfig(): RsoConfig | null {
  const clientId = process.env.RSO_CLIENT_ID?.trim();
  const redirectUri = process.env.RSO_REDIRECT_URI?.trim();
  if (!clientId || !redirectUri) return null;
  return { clientId, redirectUri, clientSecret: process.env.RSO_CLIENT_SECRET?.trim() || null };
}

export function buildAuthorizeUrl(cfg: RsoConfig, state: string): string {
  const p = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: "code",
    scope: "openid offline_access",
    state,
  });
  return `${AUTHORIZE_URL}?${p.toString()}`;
}

export function tokenRequestBody(cfg: RsoConfig, code: string): string {
  const p = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: cfg.clientId,
    code,
    redirect_uri: cfg.redirectUri,
  });
  if (cfg.clientSecret) p.set("client_secret", cfg.clientSecret);
  return p.toString();
}

export function decodeJwtSub(jwt: string): string | null {
  try {
    const payload = jwt.split(".")[1];
    if (!payload) return null;
    const json = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return typeof json.sub === "string" ? json.sub : null;
  } catch {
    return null;
  }
}

async function authFetch(url: string, init: RequestInit, label: string): Promise<any> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(15000) });
  } catch {
    throw new UpstreamError(`${label} failed: network error`, 502);
  }
  if (!res.ok) throw new UpstreamError(`${label} failed (HTTP ${res.status}).`, 401);
  return res.json();
}

export async function exchangeCodeForTokens(
  cfg: RsoConfig,
  code: string
): Promise<{ accessToken: string; idToken: string; entitlementsToken: string; puuid: string }> {
  const tok = await authFetch(
    TOKEN_URL,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: tokenRequestBody(cfg, code),
    },
    "Riot OAuth code exchange"
  );
  const accessToken: string | undefined = tok?.access_token;
  if (!accessToken) throw new UpstreamError("Riot OAuth response missing access_token (check client config).", 401);

  let puuid = decodeJwtSub(tok?.id_token ?? "") ?? "";
  const ui = await fetch(USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(15000),
  }).catch(() => null);
  if (ui && ui.ok) {
    const j = await ui.json().catch(() => null);
    if (j?.sub) puuid = j.sub;
  }
  if (!puuid) throw new UpstreamError("Could not resolve PUUID from the RSO token.", 401);

  const ent = await fetch(ENTITLEMENTS_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: "{}",
    signal: AbortSignal.timeout(15000),
  }).catch(() => null);
  if (!ent || !ent.ok) {
    throw new UpstreamError(
      `Riot entitlements refused the RSO token (HTTP ${ent ? ent.status : "network"}). ` +
        "Inventory access via a third-party RSO client may not be enabled for this app yet — confirm with Riot during app review.",
      403
    );
  }
  const ej = await ent.json().catch(() => null);
  const entitlementsToken: string | undefined = ej?.entitlements_token;
  if (!entitlementsToken) throw new UpstreamError("Entitlements response missing entitlements_token.", 403);

  return { accessToken, idToken: typeof tok?.id_token === "string" ? tok.id_token : "", entitlementsToken, puuid };
}

export async function handleRsoExchange(code: string, region: Region): Promise<ShowcasePayload> {
  const cfg = getRsoConfig();
  if (!cfg) throw new UpstreamError("RSO is not configured — set RSO_CLIENT_ID and RSO_REDIRECT_URI.", 400);
  const t = await exchangeCodeForTokens(cfg, code);
  // Auto-detect region (same riot-geo call every other flow uses); fall back to the client's value.
  const detected = t.idToken ? await detectRegion(t.accessToken, t.idToken) : null;
  return buildShowcase({
    region: detected ?? region,
    accessToken: t.accessToken,
    entitlementsToken: t.entitlementsToken,
    puuid: t.puuid,
  });
}
