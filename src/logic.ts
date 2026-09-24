import type { BuddyItem, CardItem, ItemKind, Selection, ShowcasePayload, SkinItem, TitleItem } from "./types";
import { selKey } from "./types";

export const PREMIUM_PRICE = 1775;
export const MAX_GRID_ITEMS = 120;

/** Official VALORANT loadout order (melee handled separately via isKnife). */
export const WEAPON_ORDER = [
  "Classic",
  "Shorty",
  "Frenzy",
  "Ghost",
  "Bandit",
  "Sheriff",
  "Stinger",
  "Spectre",
  "Bucky",
  "Judge",
  "Bulldog",
  "Guardian",
  "Phantom",
  "Vandal",
  "Marshal",
  "Outlaw",
  "Operator",
  "Ares",
  "Odin",
] as const;

const ORDER_KEYS = [...WEAPON_ORDER.map((w) => w.toUpperCase()), "MELEE"];

/** Uppercase gun label for a skin (MELEE for knives; falls back to weaponName). */
export function gunLabel(s: Pick<SkinItem, "weaponName" | "isKnife">): string {
  if (s.isKnife) return "MELEE";
  const w = s.weaponName.trim();
  if (!w) return "OTHER";
  for (const name of WEAPON_ORDER) {
    if (w.toLowerCase() === name.toLowerCase()) return name.toUpperCase();
  }
  for (const name of WEAPON_ORDER) {
    if (w.toLowerCase().includes(name.toLowerCase())) return name.toUpperCase();
  }
  return w.toUpperCase();
}

export interface GunGroup {
  id: string;
  label: string;
  items: SkinItem[];
}

/** Group skins by real gun name in official loadout order; unknown guns last (first-seen). */
export function groupByGun(items: SkinItem[]): GunGroup[] {
  const buckets = new Map<string, SkinItem[]>();
  const unknownSeen: string[] = [];
  for (const s of items) {
    const k = gunLabel(s);
    if (!buckets.has(k)) {
      buckets.set(k, []);
      if (!ORDER_KEYS.includes(k)) unknownSeen.push(k);
    }
    buckets.get(k)!.push(s);
  }
  const known = ORDER_KEYS.filter((k) => buckets.has(k)).map((k) => ({
    id: k,
    label: k,
    items: buckets.get(k)!,
  }));
  const unknown = unknownSeen.map((k) => ({ id: k, label: k, items: buckets.get(k)! }));
  return [...known, ...unknown];
}

export type AnyItem = SkinItem | CardItem | TitleItem | BuddyItem;

export function defaultChecked(kind: ItemKind, item: AnyItem, pricesAvailable: boolean): boolean {
  void pricesAvailable; // price-map coverage is partial; null price always uses the level heuristic for skins
  if (item.equipped) return true;
  if (item.price != null) return kind === "skin" ? item.price >= PREMIUM_PRICE : true;
  if (kind === "skin") return (item as SkinItem).levelCount >= 5;
  return false;
}

export function buildSelection(payload: ShowcasePayload): Selection {
  const sel: Selection = {};
  const add = (kind: ItemKind, item: AnyItem) => {
    sel[selKey(kind, item.id)] = defaultChecked(kind, item, payload.pricesAvailable);
  };
  payload.skins.forEach((i) => add("skin", i));
  payload.cards.forEach((i) => add("card", i));
  payload.titles.forEach((i) => add("title", i));
  payload.buddies.forEach((i) => add("buddy", i));
  return sel;
}

export function collectionValue(payload: ShowcasePayload, sel: Selection): number {
  let total = 0;
  const check = (kind: ItemKind, items: AnyItem[]) => {
    for (const i of items) if (sel[selKey(kind, i.id)] && i.price != null) total += i.price;
  };
  check("skin", payload.skins);
  check("card", payload.cards);
  check("title", payload.titles);
  check("buddy", payload.buddies);
  return total;
}

export function rarityColor(price: number | null): string {
  if (price == null) return "#4a5560";
  if (price >= 2475) return "#e8c860";
  if (price >= PREMIUM_PRICE) return "#a866ff";
  return "#7fa3c8";
}

const BRACKETS: { name: string; from: number; color: string }[] = [
  { name: "Radiant", from: 24, color: "#fff3c4" },
  { name: "Immortal", from: 21, color: "#ff5c73" },
  { name: "Ascendant", from: 18, color: "#2ee6a8" },
  { name: "Diamond", from: 15, color: "#b49bff" },
  { name: "Platinum", from: 12, color: "#5fd8e6" },
  { name: "Gold", from: 9, color: "#e8c860" },
  { name: "Silver", from: 6, color: "#c0c0c0" },
  { name: "Bronze", from: 3, color: "#b87333" },
  { name: "Iron", from: 0, color: "#8a8a8a" },
];

export function tierInfo(tier: number | null): { name: string; color: string } {
  if (tier == null || tier < 0) return { name: "UNRANKED", color: "#8B97A0" };
  const b = BRACKETS.find((x) => tier >= x.from)!;
  if (b.from === 24 || tier > 23) return { name: "RADIANT", color: b.color };
  return { name: `${b.name.toUpperCase()} ${tier - b.from + 1}`, color: b.color };
}

export const DENSITIES = [
  { name: "comfort", cols: 4, rows: 5, capacity: 20 },
  { name: "standard", cols: 5, rows: 5, capacity: 25 },
  { name: "dense", cols: 8, rows: 5, capacity: 40 },
] as const;

export type Density = (typeof DENSITIES)[number];

export interface Pages {
  density: Density;
  gridPages: SkinItem[][];
  totalSelected: number;
  truncated: number;
}

/** Chunk gun-ordered groups into pages of `cap`, preferring not to split a gun across a boundary. */
function chunkByGunGroups(groups: SkinItem[][], cap: number): SkinItem[][] {
  const pages: SkinItem[][] = [];
  let cur: SkinItem[] = [];
  for (const g of groups) {
    let i = 0;
    while (i < g.length) {
      const space = cap - cur.length;
      if (space <= 0) {
        pages.push(cur);
        cur = [];
        continue;
      }
      // Whole group fits on a fresh page but not the remainder of this one → break early.
      if (cur.length > 0 && g.length - i > space && g.length - i <= cap) {
        pages.push(cur);
        cur = [];
        continue;
      }
      const take = Math.min(space, g.length - i);
      cur.push(...g.slice(i, i + take));
      i += take;
    }
  }
  if (cur.length > 0) pages.push(cur);
  return pages;
}

export function paginate(selected: SkinItem[]): Pages {
  const total = selected.length;
  const density = DENSITIES.find((d) => Math.ceil(total / d.capacity) <= 3) ?? DENSITIES[2];
  const cap = density.capacity;
  const maxItems = cap * 3;

  let groups = groupByGun(selected).map((g) => g.items);
  const count = (gs: SkinItem[][]) => gs.reduce((n, g) => n + g.length, 0);
  let truncated = 0;
  while (count(groups) > maxItems && groups.length > 0) {
    const last = groups[groups.length - 1];
    if (count(groups) - last.length >= maxItems) {
      truncated += last.length;
      groups.pop();
    } else {
      const overflow = count(groups) - maxItems;
      truncated += overflow;
      groups[groups.length - 1] = last.slice(0, last.length - overflow);
      break;
    }
  }

  const gridPages = chunkByGunGroups(groups, cap);
  if (gridPages.length === 0) gridPages.push([]);
  return { density, gridPages, totalSelected: total, truncated };
}
