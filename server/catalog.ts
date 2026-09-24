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
  const lc = (s: unknown) => (typeof s === "string" ? s.toLowerCase() : "");
  for (const w of weapons.data ?? []) {
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
        if (c) {
          data.skins.set(c, entry);
          data.chromaToSkin.set(c, skinUuid);
        }
      }
    }
  }
  for (const c of cards.data ?? []) {
    const id = lc(c.uuid);
    if (id) data.cards.set(id, { name: c.displayName, icon: c.displayIcon ?? c.largeArt ?? null });
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
