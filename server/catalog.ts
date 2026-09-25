const CATALOG_TTL_MS = 24 * 60 * 60 * 1000;
const VERSION_TTL_MS = 6 * 60 * 60 * 1000;

export interface SkinIndexEntry {
  weaponUuid: string;
  weaponName: string;
  category: string;
  defaultSkinUuid: string | null;
  skin: any;
}

export interface RankTierInfo {
  name: string;
  icon: string | null;
  color: string;
}

export interface Catalog {
  skins: Map<string, SkinIndexEntry>;
  cards: Map<string, { name: string; icon: string | null; avatar: string | null }>;
  titles: Map<string, { name: string; text: string }>;
  buddies: Map<string, { name: string; icon: string | null }>;
  /** tier index → official badge (latest competitivetiers table). */
  rankTiers: Map<number, RankTierInfo>;
  /** contentTierUuid → rank (0 Select … 4 Ultra). */
  contentTiers: Map<string, number>;
  /** Uppercase weapon displayName → official default-weapon render (displayIcon). */
  weaponIcons: Map<string, string>;
}

let cache: { at: number; data: Catalog } | null = null;
let versionCache: { at: number; value: string } | null = null;

async function getJson(url: string): Promise<any> {
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`catalog fetch failed (${res.status})`);
  return res.json();
}

/** RGBA hex from the API (`rrggbbaa`) → CSS `#rrggbb`. */
function cssHex(rgba: string | null | undefined): string {
  if (typeof rgba !== "string" || rgba.length < 6) return "#8b97a0";
  return `#${rgba.slice(0, 6).toLowerCase()}`;
}

function indexRankTiers(raw: any): Map<number, RankTierInfo> {
  const out = new Map<number, RankTierInfo>();
  const tables: any[] = Array.isArray(raw?.data) ? raw.data : [];
  // Last table = current episode (Episode 5+ includes Ascendant; 0=UNRANKED, 1–2 unused).
  const latest = tables[tables.length - 1];
  for (const t of latest?.tiers ?? []) {
    if (typeof t?.tier !== "number") continue;
    const name = typeof t.tierName === "string" ? t.tierName : "";
    if (!name || name.startsWith("Unused")) continue;
    out.set(t.tier, {
      name: name.toUpperCase(),
      icon: t.largeIcon ?? t.smallIcon ?? null,
      color: cssHex(t.color),
    });
  }
  return out;
}

/** contentTierUuid → rank (0 Select … 4 Ultra). */
function indexContentTiers(raw: any): Map<string, number> {
  const out = new Map<string, number>();
  for (const t of raw?.data ?? []) {
    const id = typeof t?.uuid === "string" ? t.uuid.toLowerCase() : "";
    if (id && typeof t?.rank === "number") out.set(id, t.rank);
  }
  return out;
}

export async function getCatalog(): Promise<Catalog> {
  if (cache && Date.now() - cache.at < CATALOG_TTL_MS) return cache.data;
  const [weapons, cards, titles, buddies, ranks, contentTiers] = await Promise.all([
    getJson("https://valorant-api.com/v1/weapons"),
    getJson("https://valorant-api.com/v1/playercards"),
    getJson("https://valorant-api.com/v1/playertitles"),
    getJson("https://valorant-api.com/v1/buddies"),
    getJson("https://valorant-api.com/v1/competitivetiers").catch(() => null),
    getJson("https://valorant-api.com/v1/contenttiers").catch(() => null),
  ]);
  const data: Catalog = {
    skins: new Map(),
    cards: new Map(), titles: new Map(), buddies: new Map(),
    rankTiers: indexRankTiers(ranks),
    contentTiers: indexContentTiers(contentTiers),
    weaponIcons: new Map(),
  };
  const lc = (s: unknown) => (typeof s === "string" ? s.toLowerCase() : "");
  for (const w of weapons.data ?? []) {
    // Official default-weapon render for empty showcase slots (key = uppercase name).
    const wIcon = typeof w.displayIcon === "string" && w.displayIcon
      ? w.displayIcon
      : typeof w.skins?.[0]?.displayIcon === "string" && w.skins[0].displayIcon
        ? w.skins[0].displayIcon
        : null;
    const wKey = typeof w.displayName === "string" ? w.displayName.trim().toUpperCase() : "";
    if (wKey && wIcon) data.weaponIcons.set(wKey, wIcon);
    for (const skin of w.skins ?? []) {
      const skinUuid = lc(skin.uuid);
      if (!skinUuid) continue;
      const entry: SkinIndexEntry = {
        weaponUuid: lc(w.uuid), weaponName: w.displayName,
        category: w.category ?? "", defaultSkinUuid: lc(w.defaultSkinUuid) || null, skin,
      };
      data.skins.set(skinUuid, entry);
      // Entitlements have returned skin UUIDs, level UUIDs, and chroma UUIDs at times —
      // index every id that can appear as ItemID so joins don't drop the whole inventory.
      for (const lvl of skin.levels ?? []) {
        const l = lc(lvl.uuid);
        if (l) data.skins.set(l, entry);
      }
      for (const ch of skin.chromas ?? []) {
        const c = lc(ch.uuid);
        if (c) data.skins.set(c, entry);
      }
    }
  }
  for (const c of cards.data ?? []) {
    const id = lc(c.uuid);
    if (id) {
      data.cards.set(id, {
        name: c.displayName,
        // largeArt = official card portrait 268×640 (Collection slot); displayIcon = 128×128 avatar.
        icon: c.largeArt ?? c.displayIcon ?? null,
        avatar: c.displayIcon ?? c.largeArt ?? null,
      });
    }
  }
  for (const t of titles.data ?? []) {
    const id = lc(t.uuid);
    if (id) data.titles.set(id, { name: t.displayName, text: t.titleText ?? t.displayName });
  }
  for (const b of buddies.data ?? []) {
    const entry = { name: b.displayName, icon: b.displayIcon ?? b.levels?.[0]?.displayIcon ?? null };
    const root = lc(b.uuid);
    if (root) data.buddies.set(root, entry);
    // entitlements return buddy *level* uuids, not the root buddy uuid
    for (const lvl of b.levels ?? []) {
      const id = lc(lvl.uuid);
      if (id) data.buddies.set(id, entry);
    }
  }
  cache = { at: Date.now(), data };
  return data;
}

let buildCache: { at: number; value: string } | null = null;

export async function getClientBuild(): Promise<string> {
  if (buildCache && Date.now() - buildCache.at < VERSION_TTL_MS) return buildCache.value;
  const v = await getJson("https://valorant-api.com/v1/version");
  const value = v.data?.riotClientBuild ?? "111.0.0.0";
  buildCache = { at: Date.now(), value };
  return value;
}

export async function getClientVersion(): Promise<string> {
  if (versionCache && Date.now() - versionCache.at < VERSION_TTL_MS) return versionCache.value;
  const v = await getJson("https://valorant-api.com/v1/version");
  const value = v.data?.riotClientVersion ?? "release-0.0.0-shipping-0-000000";
  versionCache = { at: Date.now(), value };
  return value;
}
