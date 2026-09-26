import type { ChromaOption, RankBadge, Region, ShowcasePayload, SkinItem, CardItem, TitleItem, BuddyItem, StoreOffer, StoreSection, AccessoryOffer } from "../src/types";
import { getCatalog, getClientVersion, type Catalog } from "./catalog";

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
    if (critical) throw new UpstreamError(`${label} failed: network error`, 502);
    return null;
  }
  if (!res.ok) {
    if (critical) throw statusError(res.status, label);
    return null;
  }
  try {
    return await res.json();
  } catch {
    if (critical) throw new UpstreamError(`${label}: invalid JSON response`, 502);
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

/** Highest-level skin art: last level displayIcon → skin displayIcon. */
function skinArt(skin: any): string | null {
  const levels: any[] = Array.isArray(skin?.levels) ? skin.levels : [];
  const last = levels.length ? levels[levels.length - 1]?.displayIcon : null;
  if (typeof last === "string" && last) return last;
  return typeof skin?.displayIcon === "string" && skin.displayIcon ? skin.displayIcon : null;
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
  const tierRank = (skin: any): number | null => {
    const tierUuid = typeof skin?.contentTierUuid === "string" ? skin.contentTierUuid.toLowerCase() : "";
    return tierUuid ? catalog.contentTiers.get(tierUuid) ?? null : null;
  };
  const toOffer = (offer: any, discountPrice?: number | null): StoreOffer | null => {
    const raw = offer?.Rewards?.[0]?.ItemID;
    if (typeof raw !== "string" || !raw) return null;
    const skinId = raw.toLowerCase();
    const entry = catalog.skins.get(skinId);
    if (!entry) return null;
    return {
      skinId,
      name: typeof entry.skin?.displayName === "string" && entry.skin.displayName ? entry.skin.displayName : "Unknown skin",
      icon: skinArt(entry.skin),
      price: vpFromCost(offer.Cost),
      discountPrice: discountPrice ?? null,
      owned: ownedIds.has(skinId),
      contentTierRank: tierRank(entry.skin),
    };
  };
  const daily = (sf?.SkinsPanelLayout?.SingleItemStoreOffers ?? [])
    .map((o: any) => toOffer(o))
    .filter((o: StoreOffer | null): o is StoreOffer => o !== null);
  const seconds = sf?.SkinsPanelLayout?.SingleItemOffersRemainingDurationInSeconds;
  const nmRaw: any[] = Array.isArray(sf?.BonusStore?.BonusStoreOffers) ? sf.BonusStore.BonusStoreOffers : [];
  const nightMarket = nmRaw
    .filter((o) => !o?.IsTrial)
    .map((o: any) =>
      toOffer(o?.Offer, typeof o?.DiscountPrice === "number" ? o.DiscountPrice : null)
    )
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

  const [entSkins, entCards, entTitles, entBuddies] = await Promise.all([
    pdGet(`/store/v1/entitlements/${puuid}/${ITEM_TYPE.skins}`, true, "Owned skins"),
    pdGet(`/store/v1/entitlements/${puuid}/${ITEM_TYPE.cards}`, true, "Owned player cards"),
    pdGet(`/store/v1/entitlements/${puuid}/${ITEM_TYPE.titles}`, true, "Owned player titles"),
    pdGet(`/store/v1/entitlements/${puuid}/${ITEM_TYPE.buddies}`, true, "Owned buddies"),
  ]);

  const [storefrontBody, walletBody, xpBody, mmrBody, loadoutV3, nameBody] = await Promise.all([
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

    const equippedChroma = equippedChromaBySkin.get(skinUuid);
    const defaultChromaId =
      (equippedChroma && chromas.some((c) => c.id === equippedChroma) && equippedChroma) ||
      chromas[0]?.id ||
      null;
    const baseIcon = skinArt(entry.skin);
    const activeChroma = chromas.find((c) => c.id === defaultChromaId);
    const isKnife =
      entry.category.toLowerCase().includes("knife") || /knife|melee/i.test(entry.weaponName);

    const tierUuid = typeof entry.skin.contentTierUuid === "string" ? entry.skin.contentTierUuid.toLowerCase() : "";
    bySkinUuid.set(skinUuid, {
      id: skinUuid,
      name: entry.skin.displayName ?? "Unknown skin",
      weaponName: entry.weaponName,
      icon: activeChroma?.icon ?? baseIcon,
      price: pricesAvailable ? priceMap!.get(skinUuid) ?? null : null,
      levelCount: levels.length,
      variantCount: chromas.length,
      isKnife,
      equipped: equippedSkins.has(skinUuid),
      contentTierRank: tierUuid ? catalog.contentTiers.get(tierUuid) ?? null : null,
      chromas,
      defaultChromaId,
    });
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

  return {
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
    skins, cards, titles, buddies,
    pricesAvailable,
    // Uppercase gun label → official default-weapon render (empty-slot art).
    defaultIcons: Object.fromEntries(catalog.weaponIcons),
    store,
    generatedAt: new Date().toISOString(),
  };
}

