import type { ChromaOption, RankBadge, Region, ShowcasePayload, SkinItem, CardItem, TitleItem, BuddyItem, AgentItem, StoreOffer, StoreSection, AccessoryOffer, ProfileStats, RecentMatch, MatchWindow } from "../src/types";
import { getCatalog, getClientVersion, type Catalog, type SkinIndexEntry } from "./catalog";
import { withShareProof } from "./shareManifest";

export class UpstreamError extends Error {
  constructor(message: string, readonly httpStatus = 502) {
    super(message);
  }
}

export const SHARD_BY_REGION: Record<Region, string> = {
  latam: "na", br: "na", na: "na", eu: "eu", ap: "ap", kr: "kr",
};

const CLIENT_PLATFORM =
  "ew0KCSJwbGF0Zm9ybVR5cGUiOiAiUEMiLA0KCSJwbGF0Zm9ybU9TIjogIldpbmRvd3MiLA0KCSJwbGF0Zm9ybU9TVmVyc2lvbiI6ICIxMC4wLjE5MDQyLjEuMjU2LjY0Yml0IiwNCgkicGxhdGZvcm1DaGlwc2V0IjogIlVua25vd24iDQp9";

export const ITEM_TYPE = {
  skins: "e7c63390-eda7-46e0-bb7a-a6abdacd2433",
  variants: "3ad1b2b2-acdb-4524-852f-954a76ddae0a",
  agents: "01bb38e1-da47-4e6a-9b3d-945fe4655707",
  cards: "3f296c07-64c3-494c-923b-fe692a4fa1bd",
  titles: "de7caa6b-adf7-4588-bbd1-143831e786c6",
  buddies: "dd3bf334-87f3-40bd-b043-682a57a8dc3a",
} as const;

const VP_CURRENCY = "85ad13f7-3d1b-5128-9eb2-7cd8ee0b5741";
const VP_CURRENCY_LEGACY = "85ad13f7-3d1b-512d-6e5d-26b47a83e808";
const RP_CURRENCY = "e59aa87c-4cbf-517a-5983-6e81511be9b7";
const RP_CURRENCY_LEGACY = "e046853e-4d7d-4d58-88ad-68b3dcef81a6";
const KC_CURRENCY = "85ca954a-41f2-ce94-9b45-8ca3dd39a00d";

function vpFromCost(cost: any): number | null {
  if (!cost || typeof cost !== "object") return null;
  for (const id of [VP_CURRENCY, VP_CURRENCY_LEGACY]) {
    if (typeof cost[id] === "number") return cost[id];
  }
  if (typeof cost.valorantPoints === "number") return cost.valorantPoints;
  return null;
}

/** Kingdom Credits (accessory store). */
function kcFromCost(cost: any): number | null {
  if (!cost || typeof cost !== "object") return null;
  return typeof cost[KC_CURRENCY] === "number" ? cost[KC_CURRENCY] : null;
}

function statusError(status: number, label: string): UpstreamError {
  if (status === 401) return new UpstreamError("Access token is invalid or expired — copy a fresh one and retry.", 401);
  if (status === 403) return new UpstreamError("Entitlements token is invalid or expired — copy a fresh one and retry.", 401);
  if (status === 429) return new UpstreamError("Rate limited by Riot — wait a minute and retry.", 429);
  if (status === 404) return new UpstreamError(`${label}: not found — check the selected region.`, 404);
  return new UpstreamError(`${label} failed (HTTP ${status}).`, 502);
}

async function requestJson(url: string, opts: { critical?: boolean; label?: string; init?: RequestInit } = {}): Promise<any | null> {
  const { critical = false, label = "Upstream request", init = {} } = opts;
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(15000) });
  } catch {
    // Non-critical failures are silent by design in the payload — log why.
    if (critical) throw new UpstreamError(`${label} failed: network error`, 502);
    console.log(`[upstream] ${label} → network error`);
    return null;
  }
  if (!res.ok) {
    if (critical) throw statusError(res.status, label);
    console.log(`[upstream] ${label} → HTTP ${res.status}`);
    return null;
  }
  try {
    return await res.json();
  } catch {
    if (critical) throw new UpstreamError(`${label}: invalid JSON response`, 502);
    console.log(`[upstream] ${label} → invalid JSON`);
    return null;
  }
}

export function parseEntitlements(body: any, typeId: string): string[] {
  const mapIds = (list: any[]): string[] =>
    list
      .map((e: any) => e?.ItemID ?? e?.itemId)
      .filter((x: any): x is string => typeof x === "string")
      .map((x) => x.toLowerCase());
  const sections = body?.EntitlementsByTypes;
  if (Array.isArray(sections)) {
    for (const s of sections) {
      const id = s?.ItemTypeID ?? s?.itemTypeId ?? s?.TypeID;
      if (typeof id === "string" && id.toLowerCase() === typeId.toLowerCase()) return mapIds(s.Entitlements ?? []);
    }
    return [];
  }
  // Per-type endpoint returns { ItemTypeID, Entitlements } (flat) — Riot changed this shape.
  if (Array.isArray(body?.Entitlements)) {
    const t = typeof body.ItemTypeID === "string" ? body.ItemTypeID.toLowerCase() : null;
    if (!t || t === typeId.toLowerCase()) return mapIds(body.Entitlements);
  }
  return [];
}

export function buildPriceMapFromStorefront(sf: any): Map<string, number> {
  const map = new Map<string, number>();
  const addOffer = (offer: any, basePriceOverride?: number) => {
    if (!offer) return;
    const vp =
      typeof basePriceOverride === "number" ? basePriceOverride : vpFromCost(offer.Cost);
    if (vp == null) return;
    for (const r of offer.Rewards ?? []) {
      if (typeof r?.ItemID === "string") map.set(r.ItemID.toLowerCase(), vp);
    }
  };
  // Daily rotational store (standard VP prices)
  for (const o of sf?.SkinsPanelLayout?.SingleItemStoreOffers ?? []) addOffer(o);
  // Featured bundles — BasePrice on each item
  for (const b of [...(sf?.FeaturedBundle?.Bundles ?? []), ...(sf?.FeaturedBundle?.Bundle ? [sf.FeaturedBundle.Bundle] : [])]) {
    for (const it of b?.Items ?? []) {
      const id = it?.Item?.ItemID;
      if (typeof id === "string" && typeof it.BasePrice === "number") map.set(id.toLowerCase(), it.BasePrice);
    }
    for (const oo of b?.ItemOffers ?? []) addOffer(oo?.Offer);
  }
  // Night market — use standard Cost, not the discount
  for (const o of sf?.BonusStore?.BonusStoreOffers ?? []) addOffer(o?.Offer);
  // Accessory store is Kingdom-Credit priced — excluded from the VP map
  // (its prices are surfaced separately by buildStoreSection).
  return map;
}

/** Standard VP price per content-tier rank (Select 875 → Ultra 2475). */
const TIER_VP: Record<number, number> = { 0: 875, 1: 1275, 2: 1775, 3: 2175, 4: 2475 };

/**
 * Catalog-wide VP price: the storefront price when the skin is in today's
 * store, otherwise the standard price for its content tier. Without this,
 * only the ~10 items in today's offers would carry a price and any
 * collection-value total would read as 0.
 */
export function tierVpPrice(rank: number | null): number | null {
  return rank == null ? null : TIER_VP[rank] ?? null;
}

/** Highest-level skin art: last level displayIcon → skin displayIcon. */
function skinArt(skin: any): string | null {
  const levels: any[] = Array.isArray(skin?.levels) ? skin.levels : [];
  const last = levels.length ? levels[levels.length - 1]?.displayIcon : null;
  if (typeof last === "string" && last) return last;
  return typeof skin?.displayIcon === "string" && skin.displayIcon ? skin.displayIcon : null;
}

/**
 * Catalog skin entry → showcase item. `price` falls back to the content-tier
 * list price; `equippedChromaId` becomes the default variant when it belongs
 * to the skin. Shared by sign-in and share-link snapshots so both render the
 * same art, variants and rarity.
 */
export function skinItemFromCatalog(
  entry: SkinIndexEntry,
  catalog: Catalog,
  opts: { price?: number | null; equipped?: boolean; equippedChromaId?: string | null } = {}
): SkinItem {
  const skinUuid = String(entry.skin.uuid ?? "").toLowerCase();
  const levels: any[] = entry.skin.levels ?? [];
  const chromasRaw: any[] = entry.skin.chromas ?? [];
  // Full catalog chroma list for owned skins (matches the client's variant
  // picker — variant entitlements under-return and are display-only here).
  const chromas: ChromaOption[] = chromasRaw
    .map((ch: any, idx: number) => {
      const id = typeof ch?.uuid === "string" ? ch.uuid.toLowerCase() : "";
      if (!id) return null;
      const name = (
        typeof ch?.displayName === "string" && ch.displayName.trim()
          ? ch.displayName
          : idx === 0
            ? "Default"
            : `Variant ${idx + 1}`
      )
        .replace(/\s+/g, " ")
        .trim();
      // Variant art: many skins (e.g. Recon Phantom) ship displayIcon only on
      // the base chroma — variants carry fullRender instead. A null icon makes
      // every renderer fall back to the default art, so the picker looks
      // selectable but never changes.
      const icon =
        typeof ch?.displayIcon === "string" && ch.displayIcon
          ? ch.displayIcon
          : typeof ch?.fullRender === "string" && ch.fullRender
            ? ch.fullRender
            : null;
      return { id, name, icon } satisfies ChromaOption;
    })
    .filter((c): c is ChromaOption => c !== null);

  const equippedChroma = opts.equippedChromaId?.toLowerCase();
  const defaultChromaId =
    (equippedChroma && chromas.some((c) => c.id === equippedChroma) && equippedChroma) ||
    chromas[0]?.id ||
    null;
  const baseIcon = skinArt(entry.skin);
  const activeChroma = chromas.find((c) => c.id === defaultChromaId);
  const isKnife =
    entry.category.toLowerCase().includes("knife") || /knife|melee/i.test(entry.weaponName);

  const tierUuid = typeof entry.skin.contentTierUuid === "string" ? entry.skin.contentTierUuid.toLowerCase() : "";
  const contentTierRank = tierUuid ? catalog.contentTiers.get(tierUuid)?.rank ?? null : null;
  return {
    id: skinUuid,
    name: entry.skin.displayName ?? "Unknown skin",
    weaponName: entry.weaponName,
    icon: activeChroma?.icon ?? baseIcon,
    price: opts.price ?? tierVpPrice(contentTierRank),
    levelCount: levels.length,
    variantCount: chromas.length,
    isKnife,
    equipped: !!opts.equipped,
    contentTierRank,
    chromas,
    defaultChromaId,
  };
}

/**
 * Catalog agent entry → showcase item. Shared by sign-in and share-link
 * snapshots so both render the same name/art/role.
 */
export function agentItemFromCatalog(
  id: string,
  entry: { name: string; icon: string | null; role: string | null; roleIcon: string | null }
): AgentItem {
  return {
    id: id.toLowerCase(),
    name: entry.name,
    icon: entry.icon,
    role: entry.role,
    roleIcon: entry.roleIcon,
    price: null,
    equipped: false,
  };
}

/**
 * Daily store + night market + accessory store from the storefront response
 * (already fetched for the price map). Skin offers whose item isn't in the
 * catalog are skipped.
 */
export function buildStoreSection(
  sf: any,
  catalog: Pick<Catalog, "skins" | "buddies" | "cards" | "titles" | "sprays" | "contentTiers">,
  ownedIds: ReadonlySet<string>
): StoreSection | null {
  if (!sf) return null;
  const tierOf = (skin: any): { rank: number; icon: string | null } | null => {
    const tierUuid = typeof skin?.contentTierUuid === "string" ? skin.contentTierUuid.toLowerCase() : "";
    return tierUuid ? catalog.contentTiers.get(tierUuid) ?? null : null;
  };
  const toOffer = (offer: any, discountPrice?: number | null, discountPercent?: number | null): StoreOffer | null => {
    const raw = offer?.Rewards?.[0]?.ItemID;
    if (typeof raw !== "string" || !raw) return null;
    const skinId = raw.toLowerCase();
    const entry = catalog.skins.get(skinId);
    if (!entry) return null;
    const tier = tierOf(entry.skin);
    return {
      skinId,
      name: typeof entry.skin?.displayName === "string" && entry.skin.displayName ? entry.skin.displayName : "Unknown skin",
      weaponName: entry.weaponName,
      icon: skinArt(entry.skin),
      price: vpFromCost(offer.Cost),
      discountPrice: discountPrice ?? null,
      discountPercent: discountPercent ?? null,
      owned: ownedIds.has(skinId),
      contentTierRank: tier?.rank ?? null,
      contentTierIcon: tier?.icon ?? null,
    };
  };
  const daily = (sf?.SkinsPanelLayout?.SingleItemStoreOffers ?? [])
    .map((o: any) => toOffer(o))
    .filter((o: StoreOffer | null): o is StoreOffer => o !== null);
  const seconds = sf?.SkinsPanelLayout?.SingleItemOffersRemainingDurationInSeconds;
  const nmRaw: any[] = Array.isArray(sf?.BonusStore?.BonusStoreOffers) ? sf.BonusStore.BonusStoreOffers : [];
  // Real BonusStore offer: { Offer, DiscountPercent, DiscountCosts: {vpId: n}, IsSeen } —
  // there is NO `DiscountPrice` field (older fixtures had it; keep as a fallback).
  const nightMarket = nmRaw
    .filter((o) => !o?.IsTrial)
    .map((o: any) => {
      const discountPrice =
        vpFromCost(o?.DiscountCosts) ??
        (typeof o?.DiscountPrice === "number" ? o.DiscountPrice : null);
      const discountPercent = typeof o?.DiscountPercent === "number" ? o.DiscountPercent : null;
      return toOffer(o?.Offer, discountPrice, discountPercent);
    })
    .filter((o: StoreOffer | null): o is StoreOffer => o !== null);
  // Accessory store: sprays / buddies / cards / titles, priced in Kingdom Credits.
  const toAccessory = (offer: any): AccessoryOffer | null => {
    const raw = offer?.Rewards?.[0]?.ItemID;
    if (typeof raw !== "string" || !raw) return null;
    const id = raw.toLowerCase();
    const buddy = catalog.buddies.get(id);
    if (buddy) return { id, name: buddy.name, icon: buddy.icon, kind: "buddy", price: kcFromCost(offer.Cost) };
    const card = catalog.cards.get(id);
    if (card) return { id, name: card.name, icon: card.avatar, kind: "card", price: kcFromCost(offer.Cost) };
    const title = catalog.titles.get(id);
    if (title) return { id, name: title.name, icon: null, kind: "title", price: kcFromCost(offer.Cost) };
    const spray = catalog.sprays.get(id);
    if (spray) return { id, name: spray.name, icon: spray.icon, kind: "spray", price: kcFromCost(offer.Cost) };
    return null;
  };
  const accessories = (sf?.AccessoryStore?.AccessoryStoreOffers ?? [])
    .map((o: any) => toAccessory(o?.Offer ?? o))
    .filter((o: AccessoryOffer | null): o is AccessoryOffer => o !== null);
  return {
    offers: daily,
    secondsToReset: typeof seconds === "number" && seconds > 0 ? seconds : null,
    nightMarket,
    accessories,
  };
}

export function parseRanks(body: any): { current: number | null; peak: number | null } {
  const comp = body?.QueueSkills?.competitive;
  const seasons: any[] = Object.values(comp?.SeasonalInfoBySeasonID ?? {});
  const tiers = seasons.map((s) => s?.CompetitiveTier).filter((t): t is number => typeof t === "number");
  const peak = tiers.length ? Math.max(...tiers) : null;
  let current: number | null = body?.LatestCompetitiveUpdate?.TierAfterUpdate ?? null;
  if (typeof current !== "number") current = tiers.length ? tiers[tiers.length - 1] : null;
  return { current, peak };
}

/** Attach official rank badge (icon/name/color) for a tier number. */
export function rankBadge(
  tier: number | null,
  rankTiers: Map<number, { name: string; icon: string | null; color: string }>
): RankBadge | null {
  if (tier == null) return null;
  const info = rankTiers.get(tier);
  if (!info) return null;
  return { tier, name: info.name, icon: info.icon, color: info.color };
}

export interface AccountInput {
  region: Region;
  accessToken: string;
  entitlementsToken: string;
  puuid?: string;
}

/* ---- Profile stats (editor-only Profile view): the ranked record comes free
   from the MMR payload we already fetch; recent matches add one history call,
   one competitive-updates call and a bounded match-details fan-out. Everything
   here is non-critical — any failure yields empty/null and the showcase still
   renders without the stats. ---- */

const MATCH_HISTORY_COUNT = 15;
const MATCH_DETAIL_LIMIT = 10;
const MATCH_DETAIL_CONCURRENCY = 5;
/** Queues whose matches carry a RankedRating change. */
const RR_QUEUES = new Set(["competitive", "premier"]);
/** Known queue IDs → user-facing label (others: gamemode catalog, then raw ID). */
const QUEUE_LABEL: Record<string, string> = {
  competitive: "COMPETITIVE",
  premier: "PREMIER",
  unrated: "UNRATED",
  swiftplay: "SWIFTPLAY",
  spikerush: "SPIKE RUSH",
  deathmatch: "DEATHMATCH",
};

/** Run `fn` over `items` with at most `limit` in flight; results keep input order. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return out;
}

/** Headshot share of hits (%) for the player, pooled over every round; null without damage data. */
function headshotPct(detail: any, puuid: string): number | null {
  const rounds: any[] = Array.isArray(detail?.roundResults) ? detail.roundResults : [];
  let head = 0;
  let body = 0;
  let leg = 0;
  for (const round of rounds) {
    for (const ps of round?.playerStats ?? []) {
      if (typeof ps?.subject !== "string" || ps.subject.toLowerCase() !== puuid.toLowerCase()) continue;
      for (const d of ps?.damage ?? []) {
        if (typeof d?.headshots === "number") head += d.headshots;
        if (typeof d?.bodyshots === "number") body += d.bodyshots;
        if (typeof d?.legshots === "number") leg += d.legshots;
      }
    }
  }
  const hits = head + body + leg;
  return hits > 0 ? Math.round((head / hits) * 100) : null;
}

/**
 * Slim projection of a match-details response → RecentMatch (the raw blob is
 * round-by-round and never shipped). Returns null for incomplete matches or
 * when the player isn't in the lobby.
 */
export function projectRecentMatch(
  detail: any,
  ctx: {
    puuid: string;
    rrByMatch: ReadonlyMap<string, number>;
    maps: Catalog["maps"];
    gameModes: Catalog["gameModes"];
    agents: Catalog["agents"];
  }
): RecentMatch | null {
  const info = detail?.matchInfo;
  if (!info || info.isCompleted === false) return null;
  const matchId = typeof info.matchId === "string" ? info.matchId : "";
  const startMs = typeof info.gameStartMillis === "number" ? info.gameStartMillis : 0;
  if (!matchId || !(startMs > 0)) return null;

  const players: any[] = Array.isArray(detail?.players) ? detail.players : [];
  const self = players.find(
    (p) => typeof p?.subject === "string" && p.subject.toLowerCase() === ctx.puuid.toLowerCase()
  );
  const stats = self?.stats;
  if (!self || !stats) return null;

  const queue = typeof info.queueID === "string" && info.queueID ? info.queueID : "unknown";
  // mapId is the map asset path — exactly valorant-api's mapUrl shape.
  const rawMap = typeof info.mapId === "string" ? info.mapId : "";
  const mapEntry = ctx.maps.get(rawMap.toLowerCase());
  const map = mapEntry?.name ?? rawMap.split("/").pop() ?? "Unknown map";
  // gameMode asset path shares its folder segment with gamemodes assetPath.
  const modeKey = (typeof info.gameMode === "string" ? info.gameMode.split("/")[3] ?? "" : "").toLowerCase();
  const mode =
    QUEUE_LABEL[queue] ?? (modeKey ? ctx.gameModes.get(modeKey) : undefined) ?? queue.toUpperCase();

  const teams: any[] = Array.isArray(detail?.teams) ? detail.teams : [];
  const mine = teams.find((t) => t?.teamId === self.teamId);
  const theirs = teams.find((t) => t && t.teamId !== self.teamId);
  const rounds =
    typeof stats.roundsPlayed === "number" && stats.roundsPlayed > 0 ? stats.roundsPlayed : 0;
  const agentId = typeof self.characterId === "string" ? self.characterId.toLowerCase() : "";
  const agent = ctx.agents.get(agentId);

  return {
    id: matchId,
    start: new Date(startMs).toISOString(),
    queue,
    mode,
    map,
    mapIcon: mapEntry?.icon ?? null,
    agentId: agent ? agentId : null,
    agent: agent?.name ?? "Unknown agent",
    agentIcon: agent?.icon ?? null,
    won: typeof mine?.won === "boolean" ? mine.won : null,
    score: mine ? { mine: mine.roundsWon ?? 0, theirs: theirs?.roundsWon ?? 0 } : null,
    kills: typeof stats.kills === "number" ? stats.kills : 0,
    deaths: typeof stats.deaths === "number" ? stats.deaths : 0,
    assists: typeof stats.assists === "number" ? stats.assists : 0,
    acs: rounds > 0 && typeof stats.score === "number" ? Math.round(stats.score / rounds) : 0,
    hsPct: headshotPct(detail, ctx.puuid),
    durationMs: typeof info.gameLengthMillis === "number" ? info.gameLengthMillis : null,
    rr: RR_QUEUES.has(queue) ? ctx.rrByMatch.get(matchId) ?? null : null,
  };
}

/** Aggregates over the fetched match window (null when nothing was projected). */
export function computeMatchWindow(matches: RecentMatch[]): MatchWindow | null {
  if (!matches.length) return null;
  let wins = 0;
  let losses = 0;
  let draws = 0;
  let kills = 0;
  let deaths = 0;
  let assists = 0;
  let acsSum = 0;
  let hsSum = 0;
  let hsCount = 0;
  const byAgent = new Map<string, { id: string; name: string; icon: string | null; games: number; wins: number; kills: number; deaths: number; assists: number }>();
  const byMap = new Map<string, { name: string; icon: string | null; games: number; wins: number }>();
  for (const m of matches) {
    if (m.won === true) wins++;
    else if (m.won === false) losses++;
    else draws++;
    kills += m.kills;
    deaths += m.deaths;
    assists += m.assists;
    acsSum += m.acs;
    if (m.hsPct != null) {
      hsSum += m.hsPct;
      hsCount++;
    }
    const agentKey = m.agentId ?? m.agent;
    const agent = byAgent.get(agentKey) ?? {
      id: m.agentId ?? "", name: m.agent, icon: m.agentIcon, games: 0, wins: 0, kills: 0, deaths: 0, assists: 0,
    };
    agent.games++;
    if (m.won === true) agent.wins++;
    agent.kills += m.kills;
    agent.deaths += m.deaths;
    agent.assists += m.assists;
    byAgent.set(agentKey, agent);
    const map = byMap.get(m.map) ?? { name: m.map, icon: m.mapIcon, games: 0, wins: 0 };
    map.games++;
    if (m.won === true) map.wins++;
    byMap.set(m.map, map);
  }
  const topAgents = [...byAgent.values()].sort(
    (a, b) => b.games - a.games || b.wins - a.wins || a.name.localeCompare(b.name)
  );
  const topMap = [...byMap.values()].sort((a, b) => b.games - a.games || b.wins - a.wins || a.name.localeCompare(b.name))[0] ?? null;
  return {
    games: matches.length,
    wins,
    losses,
    draws,
    kd: deaths > 0 ? Math.round((kills / deaths) * 100) / 100 : kills > 0 ? kills : null,
    hsPct: hsCount > 0 ? Math.round(hsSum / hsCount) : null,
    acs: Math.round(acsSum / matches.length),
    topAgents,
    topMap,
    form: matches.map((m) => (m.won === true ? "W" : m.won === false ? "L" : "D")),
  };
}

type PdGet = (path: string, critical?: boolean, label?: string) => Promise<any | null>;

/**
 * Recent matches: 1 history + 1 competitive-updates call, then a bounded
 * fan-out over the latest match IDs (10 detail calls at ≤5 in flight). All
 * non-critical — upstream failures resolve to [] instead of failing the
 * showcase. Newest-first, matching the history index order.
 */
export async function fetchRecentMatches(
  pdGet: PdGet,
  puuid: string,
  catalog: Pick<Catalog, "maps" | "gameModes" | "agents">
): Promise<RecentMatch[]> {
  try {
    const [history, mmr] = await Promise.all([
      pdGet(`/match-history/v1/history/${puuid}?startIndex=0&endIndex=${MATCH_HISTORY_COUNT}`, false, "Match history"),
      pdGet(`/mmr/v1/players/${puuid}/competitiveupdates?startIndex=0&endIndex=${MATCH_HISTORY_COUNT}`, false, "Competitive updates"),
    ]);
    if (!history) console.log("[matches] match-history request failed");
    else if (!Array.isArray(history.History)) {
      console.log(`[matches] unexpected history shape: ${Object.keys(history).join(",")}`);
    }
    if (!mmr) console.log("[matches] competitiveupdates request failed (RR chips will be missing)");
    const rrByMatch = new Map<string, number>();
    for (const m of mmr?.Matches ?? []) {
      if (typeof m?.MatchID === "string" && typeof m?.RankedRatingEarned === "number") {
        rrByMatch.set(m.MatchID, m.RankedRatingEarned);
      }
    }
    const entries: any[] = Array.isArray(history?.History) ? history.History : [];
    const ids = entries
      .map((e: any) => (typeof e?.MatchID === "string" ? e.MatchID : ""))
      .filter((id: string) => !!id)
      .slice(0, MATCH_DETAIL_LIMIT);
    if (!ids.length) {
      console.log(`[matches] history=${entries.length} → 0 matches (no match IDs)`);
      return [];
    }
    const details = await mapLimit(ids, MATCH_DETAIL_CONCURRENCY, (id) =>
      pdGet(`/match-details/v1/matches/${id}`, false, "Match details")
    );
    const out: RecentMatch[] = [];
    for (const d of details) {
      const m = d ? projectRecentMatch(d, { puuid, rrByMatch, ...catalog }) : null;
      if (m) out.push(m);
    }
    // One line per sign-in: how far the chain got (0 → check [upstream] lines).
    console.log(
      `[matches] history=${entries.length} details=${details.filter((d) => d).length}/${ids.length} → ${out.length} projected`
    );
    return out;
  } catch (e) {
    console.log(`[matches] failed: ${e instanceof Error ? e.message : String(e)}`);
    return [];
  }
}

/**
 * Ranked record from the MMR payload (already fetched for the rank badges):
 * current-act win/loss + RR, career totals across acts, wins per tier and the
 * act leaderboard position. All fields may be absent — nulls stay null.
 */
export function parseRankedStats(body: any): ProfileStats["ranked"] {
  const comp = body?.QueueSkills?.competitive;
  const seasons = Object.entries(comp?.SeasonalInfoBySeasonID ?? {}) as [string, any][];
  let careerWins = 0;
  let careerGames = 0;
  let anyCareer = false;
  for (const [, s] of seasons) {
    if (typeof s?.NumberOfWins === "number" && typeof s?.NumberOfGames === "number") {
      careerWins += s.NumberOfWins;
      careerGames += s.NumberOfGames;
      anyCareer = true;
    }
  }
  const latest = body?.LatestCompetitiveUpdate;
  const latestSeasonId = typeof latest?.SeasonID === "string" ? latest.SeasonID.toLowerCase() : "";
  const actEntry = latestSeasonId
    ? seasons.find(
        ([key, s]) =>
          (typeof s?.SeasonID === "string" && s.SeasonID.toLowerCase() === latestSeasonId) ||
          key.toLowerCase() === latestSeasonId
      )?.[1]
    : undefined;
  const actWins = typeof actEntry?.NumberOfWins === "number" ? actEntry.NumberOfWins : null;
  const actGames = typeof actEntry?.NumberOfGames === "number" ? actEntry.NumberOfGames : null;
  const actRr =
    typeof latest?.RankedRatingAfterUpdate === "number"
      ? latest.RankedRatingAfterUpdate
      : typeof actEntry?.RankedRating === "number"
        ? actEntry.RankedRating
        : null;
  const tiersRaw = actEntry?.WinsByTier;
  const winsByTier =
    tiersRaw && typeof tiersRaw === "object"
      ? Object.entries(tiersRaw)
          .map(([tier, wins]) => ({ tier: Number(tier), wins: typeof wins === "number" ? wins : 0 }))
          .filter((t) => Number.isFinite(t.tier) && t.wins > 0)
          .sort((a, b) => b.wins - a.wins || b.tier - a.tier)
      : [];
  const lb = actEntry?.LeaderboardRank;
  return {
    act: actWins != null && actGames != null ? { wins: actWins, games: actGames, rr: actRr } : null,
    career: anyCareer ? { wins: careerWins, games: careerGames } : null,
    winsByTier,
    leaderboardRank: typeof lb === "number" && lb > 0 ? lb : null,
  };
}

export async function buildShowcase(input: AccountInput): Promise<ShowcasePayload> {
  const shard = SHARD_BY_REGION[input.region];
  if (!shard) throw new UpstreamError("Unknown region", 400);

  const [catalog, version] = await Promise.all([getCatalog(), getClientVersion()]);

  const authHeaders = { Authorization: `Bearer ${input.accessToken}` };
  const userinfo = await requestJson("https://auth.riotgames.com/userinfo", {
    init: { headers: authHeaders }, label: "Riot auth",
  });
  const puuid = input.puuid || userinfo?.sub || "";
  if (!puuid) throw new UpstreamError("Could not resolve PUUID — access token invalid, or paste your PUUID manually.", 401);

  const pdBase = `https://pd.${shard}.a.pvp.net`;
  const pdHeaders = {
    ...authHeaders,
    "X-Riot-Entitlements-JWT": input.entitlementsToken,
    "X-Riot-ClientPlatform": CLIENT_PLATFORM,
    "X-Riot-ClientVersion": version,
    "Content-Type": "application/json",
  };
  const pdGet = (p: string, critical = false, label = p) =>
    requestJson(`${pdBase}${p}`, { init: { headers: pdHeaders }, critical, label });

  const [entSkins, entCards, entTitles, entBuddies, entAgents] = await Promise.all([
    pdGet(`/store/v1/entitlements/${puuid}/${ITEM_TYPE.skins}`, true, "Owned skins"),
    pdGet(`/store/v1/entitlements/${puuid}/${ITEM_TYPE.cards}`, true, "Owned player cards"),
    pdGet(`/store/v1/entitlements/${puuid}/${ITEM_TYPE.titles}`, true, "Owned player titles"),
    pdGet(`/store/v1/entitlements/${puuid}/${ITEM_TYPE.buddies}`, true, "Owned buddies"),
    pdGet(`/store/v1/entitlements/${puuid}/${ITEM_TYPE.agents}`, true, "Owned agents"),
  ]);

  const [storefrontBody, walletBody, xpBody, mmrBody, loadoutV3, nameBody, recentMatches] = await Promise.all([
    // offers endpoint removed by Riot — storefront (POST v3) is the current source
    requestJson(`${pdBase}/store/v3/storefront/${puuid}`, {
      init: { method: "POST", headers: pdHeaders, body: "{}" },
      label: "Storefront",
    }),
    pdGet(`/store/v1/wallet/${puuid}`, false, "Wallet"),
    pdGet(`/account-xp/v1/players/${puuid}`, false, "Account XP"),
    pdGet(`/mmr/v1/players/${puuid}`, false, "MMR"),
    pdGet(`/personalization/v3/players/${puuid}/playerloadout`, false, "Loadout"),
    requestJson(`${pdBase}/name-service/v2/players`, {
      init: { method: "PUT", headers: pdHeaders, body: JSON.stringify([puuid]) },
      label: "Name service",
    }),
    // Profile view (editor-only): 1 history + 1 competitive-updates + ≤10 details.
    fetchRecentMatches(pdGet, puuid, catalog),
  ]);
  // personalization moved v2 → v3; keep v2 as fallback
  const loadoutBody = loadoutV3 ?? (await pdGet(`/personalization/v2/players/${puuid}/playerloadout`, false, "Loadout"));

  const priceMap = storefrontBody ? buildPriceMapFromStorefront(storefrontBody) : null;
  const pricesAvailable = !!priceMap && priceMap.size > 0;

  const uniq = (ids: string[]) => [...new Set(ids.map((x) => x.toLowerCase()))];
  const equippedSkins = new Set<string>(
    (loadoutBody?.Guns ?? [])
      .map((g: any) => g?.SkinID)
      .filter((x: any): x is string => typeof x === "string")
      .map((x: string) => x.toLowerCase())
  );

  const equippedChromaBySkin = new Map<string, string>();
  for (const g of loadoutBody?.Guns ?? []) {
    const skinId = typeof g?.SkinID === "string" ? g.SkinID.toLowerCase() : "";
    const chromaId = typeof g?.ChromaID === "string" ? g.ChromaID.toLowerCase() : "";
    if (skinId && chromaId) equippedChromaBySkin.set(skinId, chromaId);
  }

  const rawSkinIds = uniq(parseEntitlements(entSkins, ITEM_TYPE.skins));
  const bySkinUuid = new Map<string, SkinItem>();
  let catalogMissed = 0;
  for (const rawId of rawSkinIds) {
    const entry = catalog.skins.get(rawId);
    if (!entry) {
      catalogMissed++;
      continue;
    }
    const skinUuid = String(entry.skin.uuid ?? "").toLowerCase();
    if (!skinUuid || skinUuid === entry.defaultSkinUuid) continue;
    if (bySkinUuid.has(skinUuid)) continue;

    bySkinUuid.set(
      skinUuid,
      skinItemFromCatalog(entry, catalog, {
        price: priceMap?.get(skinUuid),
        equipped: equippedSkins.has(skinUuid),
        equippedChromaId: equippedChromaBySkin.get(skinUuid),
      })
    );
  }
  const skins = [...bySkinUuid.values()];
  skins.sort((a, b) => (b.price ?? -1) - (a.price ?? -1) || a.name.localeCompare(b.name));
  // Counts only — no tokens/puuid — to diagnose empty joins after cookie login.
  console.log(
    `[showcase] shard=${shard} region=${input.region} entSkins=${rawSkinIds.length} joined=${skins.length} catalogMiss=${catalogMissed} catalogSkins=${catalog.skins.size} sampleMiss=${rawSkinIds.find((id) => !catalog.skins.has(id))?.slice(0, 13) ?? "-"} prices=${priceMap?.size ?? 0} pricesAvailable=${pricesAvailable}`
  );

  const equippedCardId: string | null = loadoutBody?.Identity?.PlayerCardID?.toLowerCase?.() ?? null;
  const equippedTitleId: string | null = loadoutBody?.Identity?.PlayerTitleID?.toLowerCase?.() ?? null;

  const cards: CardItem[] = uniq(parseEntitlements(entCards, ITEM_TYPE.cards)).flatMap((id) => {
    const c = catalog.cards.get(id);
    return c
      ? [{
          id,
          name: c.name,
          icon: c.icon,
          avatar: c.avatar,
          price: pricesAvailable ? priceMap!.get(id) ?? null : null,
          equipped: id === equippedCardId,
        }]
      : [];
  });
  cards.sort((a, b) => (b.price ?? -1) - (a.price ?? -1) || a.name.localeCompare(b.name));

  const titles: TitleItem[] = uniq(parseEntitlements(entTitles, ITEM_TYPE.titles)).flatMap((id) => {
    const t = catalog.titles.get(id);
    return t ? [{ id, name: t.name, text: t.text, price: pricesAvailable ? priceMap!.get(id) ?? null : null, equipped: id === equippedTitleId }] : [];
  });
  titles.sort((a, b) => a.name.localeCompare(b.name));

  const buddies: BuddyItem[] = uniq(parseEntitlements(entBuddies, ITEM_TYPE.buddies)).flatMap((id) => {
    const b = catalog.buddies.get(id);
    return b ? [{ id, name: b.name, icon: b.icon, price: pricesAvailable ? priceMap!.get(id) ?? null : null, equipped: false }] : [];
  });
  buddies.sort((a, b) => (b.price ?? -1) - (a.price ?? -1) || a.name.localeCompare(b.name));

  const agents: AgentItem[] = uniq(parseEntitlements(entAgents, ITEM_TYPE.agents)).flatMap((id) => {
    const a = catalog.agents.get(id);
    return a ? [agentItemFromCatalog(id, a)] : [];
  });
  agents.sort((a, b) => a.name.localeCompare(b.name));

  const balances = walletBody?.Balances ?? {};
  const vp =
    typeof balances[VP_CURRENCY] === "number"
      ? balances[VP_CURRENCY]
      : typeof balances[VP_CURRENCY_LEGACY] === "number"
        ? balances[VP_CURRENCY_LEGACY]
        : null;
  const rp =
    typeof balances[RP_CURRENCY] === "number"
      ? balances[RP_CURRENCY]
      : typeof balances[RP_CURRENCY_LEGACY] === "number"
        ? balances[RP_CURRENCY_LEGACY]
        : null;

  const accountLevel: number | null =
    typeof xpBody?.Progress?.Level === "number" ? xpBody.Progress.Level
    : typeof loadoutBody?.Identity?.AccountLevel === "number" ? loadoutBody.Identity.AccountLevel
    : null;

  const name0 = Array.isArray(nameBody) ? nameBody[0] : null;
  const parsedRanks = parseRanks(mmrBody);
  const store = storefrontBody
    ? buildStoreSection(storefrontBody, catalog, new Set(bySkinUuid.keys()))
    : null;

  return withShareProof({
    puuid,
    gameName: name0?.GameName ?? userinfo?.gameName ?? "UNKNOWN",
    tagLine: name0?.TagLine ?? userinfo?.tagLine ?? "",
    region: input.region,
    accountLevel,
    ranks: {
      ...parsedRanks,
      currentBadge: rankBadge(parsedRanks.current, catalog.rankTiers),
      peakBadge: rankBadge(parsedRanks.peak, catalog.rankTiers),
    },
    wallet: { vp, rp },
    skins, cards, titles, buddies, agents,
    profile: {
      ranked: parseRankedStats(mmrBody),
      matches: recentMatches,
      window: computeMatchWindow(recentMatches),
      accountCreatedAt:
        typeof userinfo?.acct?.created_at === "number" && userinfo.acct.created_at > 0
          ? new Date(userinfo.acct.created_at).toISOString()
          : null,
    },
    pricesAvailable,
    // Uppercase gun label → official default-weapon render (empty-slot art).
    defaultIcons: Object.fromEntries(catalog.weaponIcons),
    store,
    generatedAt: new Date().toISOString(),
  });
}

