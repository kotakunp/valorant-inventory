export type Region = "na" | "latam" | "br" | "eu" | "ap" | "kr";

export interface ChromaOption {
  id: string;
  name: string;
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
  /** Owned chromas (index 0 = base). Empty when catalog has none. */
  chromas: ChromaOption[];
  defaultChromaId: string | null;
}

export interface CardItem {
  id: string;
  name: string;
  icon: string | null;
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

export interface ShowcasePayload {
  puuid: string;
  gameName: string;
  tagLine: string;
  region: Region;
  accountLevel: number | null;
  ranks: { current: number | null; peak: number | null };
  wallet: { vp: number | null; rp: number | null };
  skins: SkinItem[];
  cards: CardItem[];
  titles: TitleItem[];
  buddies: BuddyItem[];
  pricesAvailable: boolean;
  generatedAt: string;
}

export type ItemKind = "skin" | "card" | "title" | "buddy";
export type Selection = Record<string, boolean>;
/** skinId → chosen chroma id (UI state only). */
export type ChromaSelection = Record<string, string>;

export const selKey = (kind: ItemKind, id: string): string => `${kind}:${id}`;
