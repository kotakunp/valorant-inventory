const CATALOG_TTL_MS = 24 * 60 * 60 * 1000;
const VERSION_TTL_MS = 6 * 60 * 60 * 1000;

export interface SkinIndexEntry {
  weaponUuid: string;
  weaponName: string;
  category: string;
  defaultSkinUuid: string | null;
  skin: any;
}

export interface Catalog {
  skins: Map<string, SkinIndexEntry>;
  chromaToSkin: Map<string, string>;
  cards: Map<string, { name: string; icon: string | null }>;
  titles: Map<string, { name: string; text: string }>;
  buddies: Map<string, { name: string; icon: string | null }>;
}

let cache: { at: number; data: Catalog } | null = null;
let versionCache: { at: number; value: string } | null = null;

async function getJson(url: string): Promise<any> {
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`catalog fetch failed (${res.status})`);
  return res.json();
}

export async function getCatalog(): Promise<Catalog> {
  if (cache && Date.now() - cache.at < CATALOG_TTL_MS) return cache.data;
  const [weapons, cards, titles, buddies] = await Promise.all([
    getJson("https://valorant-api.com/v1/weapons"),
    getJson("https://valorant-api.com/v1/playercards"),
    getJson("https://valorant-api.com/v1/playertitles"),
    getJson("https://valorant-api.com/v1/buddies"),
  ]);
  const data: Catalog = {
    skins: new Map(), chromaToSkin: new Map(),
    cards: new Map(), titles: new Map(), buddies: new Map(),
  };
  for (const w of weapons.data ?? []) {
    for (const skin of w.skins ?? []) {
      data.skins.set(skin.uuid, {
        weaponUuid: w.uuid, weaponName: w.displayName,
        category: w.category ?? "", defaultSkinUuid: w.defaultSkinUuid ?? null, skin,
      });
      for (const ch of skin.chromas ?? []) data.chromaToSkin.set(ch.uuid, skin.uuid);
    }
  }
  for (const c of cards.data ?? []) {
    data.cards.set(c.uuid, { name: c.displayName, icon: c.displayIcon ?? c.largeArt ?? null });
  }
  for (const t of titles.data ?? []) {
    data.titles.set(t.uuid, { name: t.displayName, text: t.titleText ?? t.displayName });
  }
  for (const b of buddies.data ?? []) {
    const entry = { name: b.displayName, icon: b.displayIcon ?? b.levels?.[0]?.displayIcon ?? null };
    data.buddies.set(b.uuid, entry);
    // entitlements return buddy *level* uuids, not the root buddy uuid
    for (const lvl of b.levels ?? []) data.buddies.set(lvl.uuid, entry);
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
