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

export interface AgentItem {
  id: string;
  name: string;
  /** Bust art (catalog displayIcon, 256×256 transparent). */
  icon: string | null;
  /** Role display name (e.g. "Duelist"), when the catalog has one. */
  role: string | null;
  roleIcon: string | null;
  /** Agents are never priced or equipped — the fields keep item unions total. */
  price: null;
  equipped: false;
}

/**
 * One recent match — slim server-side projection of match-details (the raw
 * round-by-round blob is never shipped). Powers the editor-only Profile view.
 */
export interface RecentMatch {
  id: string;
  /** Match start, ISO 8601. */
  start: string;
  /** Raw QueueID (competitive, unrated, hurm, …). */
  queue: string;
  /** Display label: queue name, else gamemode catalog name, else raw ID. */
  mode: string;
  map: string;
  mapIcon: string | null;
  /** Agent UUID (catalog agents key) when the details carried one. */
  agentId: string | null;
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
  /** Headshot share of hits (%), null when the round data carried no damage. */
  hsPct: number | null;
  durationMs: number | null;
  /** RankedRating earned — competitive/premier only, null elsewhere. */
  rr: number | null;
}

/** Aggregates over the fetched match window (≤10 recent matches). */
export interface MatchWindow {
  games: number;
  wins: number;
  losses: number;
  draws: number;
  /** Total kills / total deaths. */
  kd: number | null;
  /** Headshot share across matches with damage data. */
  hsPct: number | null;
  acs: number | null;
  /** Most-played first; ties broken by wins, then name. */
  topAgents: {
    id: string;
    name: string;
    icon: string | null;
    games: number;
    wins: number;
    kills: number;
    deaths: number;
    assists: number;
  }[];
  topMap: { name: string; icon: string | null; games: number; wins: number } | null;
  /** Newest first, "W" | "L" | "D" (draw/unknown). */
  form: ("W" | "L" | "D")[];
}

/**
 * Account stats for the editor-only Profile view: ranked record straight from
 * the MMR payload we already fetch, plus aggregates over the recent-match
 * fan-out. Everything non-critical — a failed part stays null/empty.
 */
export interface ProfileStats {
  ranked: {
    /** Current act ranked record + RR (ranked queues only). */
    act: { wins: number; games: number; rr: number | null } | null;
    /** Every act in the MMR payload, summed. */
    career: { wins: number; games: number } | null;
    /** Current-act wins per tier, most wins first. */
    winsByTier: { tier: number; wins: number }[];
    /** Act leaderboard position (Immortal/Radiant only). */
    leaderboardRank: number | null;
  };
  /** Newest first, ≤10 (bounded fan-out). */
  matches: RecentMatch[];
  /** Aggregates over `matches`; null when nothing was projected. */
  window: MatchWindow | null;
  /** From userinfo `acct.created_at` (ISO 8601), null when absent. */
  accountCreatedAt: string | null;
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
  /** Owned agents (Agents library tab; the picked one shows on the showcase). */
  agents?: AgentItem[];
  /** Editor-only ranked + recent-match stats (never part of the PNG). */
  profile?: ProfileStats | null;
  pricesAvailable: boolean;
  /** Uppercase gun label → official default-weapon render (empty-slot art). */
  defaultIcons?: Record<string, string>;
  /** Daily store + night market (null when the storefront wasn't available). */
  store?: StoreSection | null;
  generatedAt: string;
  /** Opaque server-signed ownership proof; sent back to create a share link. */
  shareProof?: string;
}

/** What the owner chose to show; the server checks it against `shareProof`. */
export interface SharePicks {
  skins: { id: string; chroma: string | null }[];
  /** gun id → skin id brought to the front of its stack. */
  front: Record<string, string>;
  card: string | null;
  title: string | null;
  buddies: string[];
  /** The one agent shown as "main" on the showcase (null = no agent tile). */
  agent: string | null;
}

/** A stored share: a trimmed payload holding only the shown items. */
export interface SharedShowcase {
  showcase: ShowcasePayload;
  chromaSel: ChromaSelection;
  bringToFront: Record<string, string>;
  createdAt: string;
  expiresAt: string;
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

export type ItemKind = "skin" | "card" | "title" | "buddy" | "agent";
export type Selection = Record<string, boolean>;

/**
 * Kinds the showcase renders as a single slot — one profile card, one title,
 * one "main" agent (`Showcase.tsx` picks the first checked of each kind).
 * Selecting one therefore clears the others of that kind, radio-style; skins
 * and buddies (`BUDDIES +n`) stay multi-select.
 */
export const SINGLE_SLOT_KINDS: readonly ItemKind[] = ["card", "title", "agent"];
export const isSingleSlot = (kind: ItemKind): boolean => SINGLE_SLOT_KINDS.includes(kind);
/** skinId → chosen chroma id (UI state only). */
export type ChromaSelection = Record<string, string>;

export const selKey = (kind: ItemKind, id: string): string => `${kind}:${id}`;
