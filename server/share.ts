import { randomBytes } from "node:crypto";
import type { BuddyItem, CardItem, ChromaSelection, SharedShowcase, SharePicks, SkinItem, TitleItem } from "../src/types";
import type { Catalog } from "./catalog";
import type { ShareManifest } from "./shareManifest";
import { rankBadge, skinItemFromCatalog } from "./valorant";

export const SHARE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const PREVIEW_MAX_BYTES = 512 * 1024;
const MAX_SKINS = 600;
const MAX_BUDDIES = 400;

export class ShareError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

const ID_ALPHABET = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const SHARE_ID_RE = /^[a-km-zA-HJ-NP-Z2-9]{8}$/;

/** 8 chars from a 57-symbol alphabet without look-alikes (~46 bits). */
export function newShareId(): string {
  const bytes = randomBytes(16);
  let out = "";
  for (const b of bytes) {
    // Rejection sampling keeps the distribution uniform.
    if (b >= 228) continue;
    out += ID_ALPHABET[b % ID_ALPHABET.length];
    if (out.length === 8) return out;
  }
  return newShareId();
}

const isId = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 64;
const lc = (v: string) => v.toLowerCase();

export function parsePicks(raw: any): SharePicks {
  if (!raw || typeof raw !== "object") throw new ShareError("Nothing to share.");
  const skinsIn = Array.isArray(raw.skins) ? raw.skins : [];
  const buddiesIn = Array.isArray(raw.buddies) ? raw.buddies : [];
  if (skinsIn.length > MAX_SKINS || buddiesIn.length > MAX_BUDDIES) throw new ShareError("Too many items to share.");
  const skins = skinsIn.map((s: any) => {
    if (!isId(s?.id)) throw new ShareError("Invalid skin in share.");
    return { id: lc(s.id), chroma: isId(s.chroma) ? lc(s.chroma) : null };
  });
  const front: Record<string, string> = {};
  if (raw.front && typeof raw.front === "object") {
    const entries = Object.entries(raw.front);
    if (entries.length > 64) throw new ShareError("Invalid stack order.");
    for (const [gun, skin] of entries) {
      if (typeof gun === "string" && gun.length <= 32 && isId(skin)) front[gun] = lc(skin);
    }
  }
  const buddies = buddiesIn.map((b: unknown) => {
    if (!isId(b)) throw new ShareError("Invalid buddy in share.");
    return lc(b);
  });
  return {
    skins,
    front,
    card: isId(raw.card) ? lc(raw.card) : null,
    title: isId(raw.title) ? lc(raw.title) : null,
    buddies,
  };
}

/**
 * Build the stored snapshot. Every picked id must be in the signed manifest
 * (owned by the account); names and art come from the public catalog, never
 * from the request, so a link can only show real items the account owns.
 */
export function buildSnapshot(
  m: ShareManifest,
  picks: SharePicks,
  catalog: Catalog,
  now = new Date()
): SharedShowcase {
  const ownedSkins = new Map(m.skins.map(([id, price, eq, chroma]) => [lc(id), { price, eq, chroma }]));
  const ownedCards = new Map(m.cards.map(([id, price, eq]) => [lc(id), { price, eq }]));
  const ownedTitles = new Map(m.titles.map(([id, price, eq]) => [lc(id), { price, eq }]));
  const ownedBuddies = new Map(m.buddies.map(([id, price]) => [lc(id), price]));

  const skins: SkinItem[] = [];
  const chromaSel: ChromaSelection = {};
  const seen = new Set<string>();
  for (const pick of picks.skins) {
    if (seen.has(pick.id)) continue;
    seen.add(pick.id);
    const owned = ownedSkins.get(pick.id);
    const entry = catalog.skins.get(pick.id);
    if (!owned || !entry) throw new ShareError("That selection includes an item this account doesn't own.");
    const item = skinItemFromCatalog(entry, catalog, {
      price: owned.price,
      equipped: owned.eq === 1,
      equippedChromaId: owned.chroma,
    });
    const chroma = pick.chroma && item.chromas.some((c) => c.id === pick.chroma) ? pick.chroma : item.defaultChromaId;
    if (chroma) {
      chromaSel[item.id] = chroma;
      item.icon = item.chromas.find((c) => c.id === chroma)?.icon ?? item.icon;
    }
    skins.push(item);
  }
  skins.sort((a, b) => (b.price ?? -1) - (a.price ?? -1) || a.name.localeCompare(b.name));

  const bringToFront: Record<string, string> = {};
  for (const [gun, skinId] of Object.entries(picks.front)) {
    if (seen.has(skinId)) bringToFront[gun] = skinId;
  }

  const cards: CardItem[] = [];
  if (picks.card) {
    const owned = ownedCards.get(picks.card);
    const c = catalog.cards.get(picks.card);
    if (!owned || !c) throw new ShareError("That selection includes an item this account doesn't own.");
    cards.push({ id: picks.card, name: c.name, icon: c.icon, avatar: c.avatar, price: owned.price, equipped: owned.eq === 1 });
  }

  const titles: TitleItem[] = [];
  if (picks.title) {
    const owned = ownedTitles.get(picks.title);
    const t = catalog.titles.get(picks.title);
    if (!owned || !t) throw new ShareError("That selection includes an item this account doesn't own.");
    titles.push({ id: picks.title, name: t.name, text: t.text, price: owned.price, equipped: owned.eq === 1 });
  }

  const buddies: BuddyItem[] = [];
  for (const id of new Set(picks.buddies)) {
    const b = catalog.buddies.get(id);
    if (!ownedBuddies.has(id) || !b) throw new ShareError("That selection includes an item this account doesn't own.");
    buddies.push({ id, name: b.name, icon: b.icon, price: ownedBuddies.get(id) ?? null, equipped: false });
  }

  return {
    showcase: {
      puuid: "",
      gameName: m.gameName,
      tagLine: m.tagLine,
      region: m.region,
      accountLevel: m.accountLevel,
      ranks: {
        current: m.ranks.current,
        peak: m.ranks.peak,
        currentBadge: rankBadge(m.ranks.current, catalog.rankTiers),
        peakBadge: rankBadge(m.ranks.peak, catalog.rankTiers),
      },
      wallet: { vp: m.wallet.vp, rp: m.wallet.rp },
      skins,
      cards,
      titles,
      buddies,
      pricesAvailable: m.pricesAvailable,
      defaultIcons: Object.fromEntries(catalog.weaponIcons),
      store: null,
      generatedAt: now.toISOString(),
    },
    chromaSel,
    bringToFront,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + SHARE_TTL_MS).toISOString(),
  };
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Swap the SPA's generic <title>/description for link-preview tags. */
export function injectShareMeta(html: string, share: SharedShowcase, origin: string, id: string, hasPreview: boolean): string {
  const p = share.showcase;
  const who = p.tagLine ? `${p.gameName}#${p.tagLine}` : p.gameName;
  const value = [...p.skins, ...p.cards, ...p.titles, ...p.buddies].reduce((n, i) => n + (i.price ?? 0), 0);
  const title = `${who} · VALORANT collection`;
  const parts = [`${p.skins.length} ${p.skins.length === 1 ? "skin" : "skins"}`];
  if (value > 0) parts.push(`${value.toLocaleString("en-US")} VP`);
  const description = `${parts.join(" · ")}. Hover any weapon to see every skin.`;
  const url = `${origin}/s/${id}`;
  const tags = [
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="VALORANT Collection" />`,
    `<meta property="og:title" content="${escapeHtml(title)}" />`,
    `<meta property="og:description" content="${escapeHtml(description)}" />`,
    `<meta property="og:url" content="${escapeHtml(url)}" />`,
    `<meta name="robots" content="noindex" />`,
    ...(hasPreview
      ? [
          `<meta property="og:image" content="${escapeHtml(`${url}/preview.jpg`)}" />`,
          `<meta property="og:image:width" content="1200" />`,
          `<meta property="og:image:height" content="675" />`,
          `<meta name="twitter:card" content="summary_large_image" />`,
          `<meta name="twitter:image" content="${escapeHtml(`${url}/preview.jpg`)}" />`,
        ]
      : [`<meta name="twitter:card" content="summary" />`]),
  ].join("\n    ");
  return html
    .replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(title)}</title>`)
    .replace(/(<meta\s+name="description"\s+content=")[^"]*(")/, `$1${escapeHtml(description)}$2`)
    .replace("</head>", `    ${tags}\n  </head>`);
}

/** `data:image/jpeg;base64,…` → JPEG bytes (null when absent). */
export function parsePreview(raw: unknown): Buffer | null {
  if (raw == null || raw === "") return null;
  if (typeof raw !== "string") throw new ShareError("Invalid preview image.");
  const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(raw);
  if (!m) throw new ShareError("Invalid preview image.");
  const buf = Buffer.from(m[1], "base64");
  if (buf.length > PREVIEW_MAX_BYTES) throw new ShareError("Preview image is too large.", 413);
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8 || buf[2] !== 0xff) throw new ShareError("Invalid preview image.");
  return buf;
}

export interface ShareStore {
  create(id: string, data: SharedShowcase, preview: Buffer | null): Promise<void>;
  get(id: string): Promise<SharedShowcase | null>;
  preview(id: string): Promise<Buffer | null>;
  purgeExpired(): Promise<number>;
}

/** Process-memory store for local development and tests. */
export class MemoryShareStore implements ShareStore {
  private rows = new Map<string, { data: SharedShowcase; preview: Buffer | null }>();
  constructor(private now: () => number = Date.now) {}
  private live(id: string) {
    const row = this.rows.get(id);
    return row && Date.parse(row.data.expiresAt) > this.now() ? row : null;
  }
  async create(id: string, data: SharedShowcase, preview: Buffer | null) {
    if (this.rows.has(id)) throw new Error("duplicate share id");
    this.rows.set(id, { data, preview });
  }
  async get(id: string) {
    return this.live(id)?.data ?? null;
  }
  async preview(id: string) {
    return this.live(id)?.preview ?? null;
  }
  async purgeExpired() {
    let n = 0;
    for (const [id, row] of this.rows) {
      if (Date.parse(row.data.expiresAt) <= this.now()) {
        this.rows.delete(id);
        n++;
      }
    }
    return n;
  }
}

export async function createPgShareStore(connectionString: string): Promise<ShareStore> {
  const { default: pg } = await import("pg");
  const pool = new pg.Pool({ connectionString, max: 5, idleTimeoutMillis: 30_000 });
  pool.on("error", (e) => console.error("[share] postgres pool error:", e.message));
  await pool.query(`
    create table if not exists showcase_shares (
      id text primary key,
      data jsonb not null,
      preview bytea,
      created_at timestamptz not null default now(),
      expires_at timestamptz not null
    );
    create index if not exists showcase_shares_expires_idx on showcase_shares (expires_at);
  `);
  return {
    async create(id, data, preview) {
      await pool.query(
        "insert into showcase_shares (id, data, preview, created_at, expires_at) values ($1, $2, $3, $4, $5)",
        [id, JSON.stringify(data), preview, data.createdAt, data.expiresAt]
      );
    },
    async get(id) {
      const r = await pool.query("select data from showcase_shares where id = $1 and expires_at > now()", [id]);
      return (r.rows[0]?.data as SharedShowcase | undefined) ?? null;
    },
    async preview(id) {
      const r = await pool.query("select preview from showcase_shares where id = $1 and expires_at > now()", [id]);
      return (r.rows[0]?.preview as Buffer | null | undefined) ?? null;
    },
    async purgeExpired() {
      const r = await pool.query("delete from showcase_shares where expires_at <= now()");
      return r.rowCount ?? 0;
    },
  };
}
