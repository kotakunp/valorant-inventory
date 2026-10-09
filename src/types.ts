export type Region = "na" | "latam" | "br" | "eu" | "ap" | "kr";

export interface ChromaOption {
  id: string;
  name: string;
  /** displayIcon, falling back to fullRender — many variants ship no displayIcon. */
  icon: string | null;
}

export interface SkinItem {
  id: string;
  name: string;
  weaponName: string;
  icon: string | null;
  price: number | null;
  levelCount: number;
  variantCount: number;
  isKnife: boolean;
  equipped: boolean;
  /** valorant-api content tier rank (0 Select … 4 Ultra); null when unknown. */
  contentTierRank?: number | null;
  /** All catalog chromas (index 0 = base). Empty when catalog has none. */
  chromas: ChromaOption[];
  defaultChromaId: string | null;
}

export interface CardItem {
  id: string;
  name: string;
  /** Official largeArt portrait (268×640) — showcase display. */
  icon: string | null;
  /** Square avatar (128×128 displayIcon) — compact UI chips. */
  avatar?: string | null;
  price: number | null;
  equipped: boolean;
}

export interface TitleItem {
  id: string;
  name: string;
  text: string;
  price: number | null;
  equipped: boolean;
}

export interface BuddyItem {
  id: string;
  name: string;
  icon: string | null;
  price: number | null;
  equipped: boolean;
}

/** One row in the account's store (daily offer or night-market offer). */
/**
 * Riot authorize link for one-paste sign-in: lands on playvalorant.com/opt_in
 * with `access_token`/`id_token` in the URL fragment (implicit flow).
 */
export const ACCESS_URL_LOGIN_LINK =
  "https://auth.riotgames.com/authorize" +
  "?client_id=play-valorant-web-prod" +
  "&redirect_uri=https%3A%2F%2Fplayvalorant.com%2Fopt_in" +
  "&response_type=token%20id_token" +
  "&scope=account%20openid" +
  "&nonce=1";

export interface StoreOffer {
  skinId: string;
  name: string;
  /** Weapon this skin belongs to — drives the regulated skin-art size. */
  weaponName: string;
  icon: string | null;
  price: number | null;
  /** Night market only: discounted price (standard price stays in `price`). */
  discountPrice?: number | null;
  /** Night market only: Riot-provided `DiscountPercent` (fallback: computed from prices). */
  discountPercent?: number | null;
  owned: boolean;
  /** valorant-api content tier rank (0 Select … 4 Ultra); null when unknown. */
  contentTierRank?: number | null;
  /** Official content-tier gem icon (rarity logo), when the tier is known. */
  contentTierIcon?: string | null;
}

/** Account store snapshot captured with the showcase (never exported). */
export interface StoreSection {
  /** Daily rotational store (4 offers). */
  offers: StoreOffer[];
  /** Seconds until the daily rotation, as of `generatedAt`. */
  secondsToReset: number | null;
  /** Night-market offers (empty when inactive). */
  nightMarket: StoreOffer[];
  /** Accessory-store offers (sprays/buddies/cards/titles — Kingdom-Credit priced). */
  accessories: AccessoryOffer[];
}

export interface AccessoryOffer {
  id: string;
  name: string;
  icon: string | null;
  kind: "spray" | "buddy" | "card" | "title";
  /** Kingdom Credits. */
  price: number | null;
}

/**
 * One recent match — slim server-side projection of match-details (the raw
 * round-by-round blob is never shipped). Powers the editor-only matches strip.
 */
export interface RecentMatch {
  id: string;
  /** Match start, ISO 8601. */
  start: string;
  /** Raw QueueID (competitive, unrated, hurm, …) — tab grouping key. */
  queue: string;
  /** Display label: queue name, else gamemode catalog name, else raw ID. */
  mode: string;
  map: string;
  mapIcon: string | null;
  /** Agent display name + icon for the played agent (characterId). */
  agent: string;
  agentIcon: string | null;
  /** Win/loss (null when teams were missing — e.g. forfeits). */
  won: boolean | null;
  /** Rounds won: mine vs theirs (null when teams were missing). */
  score: { mine: number; theirs: number } | null;
  kills: number;
  deaths: number;
  assists: number;
  /** Average combat score (score / roundsPlayed). */
  acs: number;
  durationMs: number | null;
  /** RankedRating earned — competitive/premier only, null elsewhere. */
  rr: number | null;
}

export interface ShowcasePayload {
  puuid: string;
  gameName: string;
  tagLine: string;
  region: Region;
  accountLevel: number | null;
  ranks: Ranks;
  wallet: { vp: number | null; rp: number | null };
  skins: SkinItem[];
  cards: CardItem[];
  titles: TitleItem[];
  buddies: BuddyItem[];
  pricesAvailable: boolean;
  /** Uppercase gun label → official default-weapon render (empty-slot art). */
  defaultIcons?: Record<string, string>;
  /** Daily store + night market (null when the storefront wasn't available). */
  store?: StoreSection | null;
  /** Recent matches for the editor strip (absent/empty → strip not rendered). */
  matches?: RecentMatch[];
  generatedAt: string;
}

/** Official competitive-tier badge (icon/color from valorant-api.com). */
export interface RankBadge {
  tier: number;
  name: string;
  icon: string | null;
  color: string;
}

export interface Ranks {
  current: number | null;
  peak: number | null;
  currentBadge?: RankBadge | null;
  peakBadge?: RankBadge | null;
}

export type ItemKind = "skin" | "card" | "title" | "buddy";
export type Selection = Record<string, boolean>;

/**
 * Kinds the showcase renders as a single slot — one profile card, one title
 * (`Showcase.tsx` takes `checkedCards[0]` / `checkedTitles[0]`). Selecting one
 * therefore clears the others of that kind, radio-style; skins and buddies
 * (`BUDDIES +n`) stay multi-select.
 */
export const SINGLE_SLOT_KINDS: readonly ItemKind[] = ["card", "title"];
export const isSingleSlot = (kind: ItemKind): boolean => SINGLE_SLOT_KINDS.includes(kind);
/** skinId → chosen chroma id (UI state only). */
export type ChromaSelection = Record<string, string>;

export const selKey = (kind: ItemKind, id: string): string => `${kind}:${id}`;
