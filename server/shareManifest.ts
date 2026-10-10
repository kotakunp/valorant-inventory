import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { deflateRawSync, inflateRawSync } from "node:zlib";
import type { Region, ShowcasePayload } from "../src/types";

/**
 * Signed ownership manifest. Issued with every showcase payload and handed
 * back when the owner creates a share link, so the server can prove that each
 * shared item is really on the account without keeping any Riot token.
 * Holds ids, prices and profile fields only (no PUUID, no tokens).
 */
export interface ShareManifest {
  v: 1;
  /** Epoch ms after which the manifest can no longer create share links. */
  exp: number;
  gameName: string;
  tagLine: string;
  region: Region;
  accountLevel: number | null;
  ranks: { current: number | null; peak: number | null };
  wallet: { vp: number | null; rp: number | null };
  pricesAvailable: boolean;
  /** [skinId, price, equipped, equippedChromaId] */
  skins: [string, number | null, 0 | 1, string | null][];
  /** [id, price, equipped] */
  cards: [string, number | null, 0 | 1][];
  titles: [string, number | null, 0 | 1][];
  buddies: [string, number | null][];
  /** Owned agent ids (validates the one "main agent" slot; absent on old manifests). */
  agents?: string[];
}

export const MANIFEST_TTL_MS = 24 * 60 * 60 * 1000;

let secret: Buffer | null = null;

function getSecret(): Buffer {
  if (secret) return secret;
  const env = process.env.SHARE_SECRET?.trim();
  if (env && env.length >= 16) {
    secret = Buffer.from(env, "utf8");
  } else {
    // Without a stable secret, manifests issued before a restart stop
    // verifying, so owners would have to sign in again before sharing.
    if (process.env.NODE_ENV === "production") {
      console.warn("[share] SHARE_SECRET is not set (or shorter than 16 chars); using a per-process secret.");
    }
    secret = randomBytes(32);
  }
  return secret;
}

/** Test hook: force a specific secret. */
export function setShareSecretForTests(value: string | null): void {
  secret = value ? Buffer.from(value, "utf8") : null;
}

const b64url = (b: Buffer) => b.toString("base64url");
const mac = (body: string) => createHmac("sha256", getSecret()).update(body).digest();

export function manifestFromPayload(p: ShowcasePayload, now = Date.now()): ShareManifest {
  return {
    v: 1,
    exp: now + MANIFEST_TTL_MS,
    gameName: p.gameName,
    tagLine: p.tagLine,
    region: p.region,
    accountLevel: p.accountLevel,
    ranks: { current: p.ranks.current, peak: p.ranks.peak },
    wallet: { vp: p.wallet.vp, rp: p.wallet.rp },
    pricesAvailable: p.pricesAvailable,
    skins: p.skins.map((s) => [s.id, s.price, s.equipped ? 1 : 0, s.defaultChromaId]),
    cards: p.cards.map((c) => [c.id, c.price, c.equipped ? 1 : 0]),
    titles: p.titles.map((t) => [t.id, t.price, t.equipped ? 1 : 0]),
    buddies: p.buddies.map((b) => [b.id, b.price]),
    agents: (p.agents ?? []).map((a) => a.id),
  };
}

export function signManifest(m: ShareManifest): string {
  const body = b64url(deflateRawSync(Buffer.from(JSON.stringify(m), "utf8")));
  return `${body}.${b64url(mac(body))}`;
}

export class ManifestError extends Error {}

export function verifyManifest(token: unknown, now = Date.now()): ShareManifest {
  if (typeof token !== "string" || token.length > 400_000) throw new ManifestError("Missing share proof.");
  const dot = token.lastIndexOf(".");
  if (dot <= 0) throw new ManifestError("Malformed share proof.");
  const body = token.slice(0, dot);
  const sig = Buffer.from(token.slice(dot + 1), "base64url");
  const expected = mac(body);
  if (sig.length !== expected.length || !timingSafeEqual(sig, expected)) {
    throw new ManifestError("Your session can't create links anymore. Sign in again to share.");
  }
  let m: ShareManifest;
  try {
    m = JSON.parse(inflateRawSync(Buffer.from(body, "base64url"), { maxOutputLength: 4_000_000 }).toString("utf8"));
  } catch {
    throw new ManifestError("Malformed share proof.");
  }
  if (m?.v !== 1 || typeof m.exp !== "number") throw new ManifestError("Malformed share proof.");
  if (m.exp < now) throw new ManifestError("Your session expired. Sign in again to create a share link.");
  return m;
}

/** Attach a fresh signed manifest to an outgoing showcase payload. */
export function withShareProof(p: ShowcasePayload): ShowcasePayload {
  return { ...p, shareProof: signManifest(manifestFromPayload(p)) };
}
