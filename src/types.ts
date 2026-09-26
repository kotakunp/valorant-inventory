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
export interface StoreOffer {
  skinId: string;
  name: string;
  icon: string | null;
  price: number | null;
  /** Night market only: discounted price (standard price stays in `price`). */
  discountPrice?: number | null;
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
/** skinId → chosen chroma id (UI state only). */
export type ChromaSelection = Record<string, string>;

export const selKey = (kind: ItemKind, id: string): string => `${kind}:${id}`;
