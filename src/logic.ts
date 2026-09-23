import type { BuddyItem, CardItem, ItemKind, Selection, ShowcasePayload, SkinItem, TitleItem } from "./types";
import { selKey } from "./types";

export const PREMIUM_PRICE = 1775;
export const KNIFE_ROW_MAX = 8;
export const MAX_GRID_ITEMS = 120;

export type AnyItem = SkinItem | CardItem | TitleItem | BuddyItem;

export function defaultChecked(kind: ItemKind, item: AnyItem, pricesAvailable: boolean): boolean {
  if (item.equipped) return true;
  if (item.price != null) return kind === "skin" ? item.price >= PREMIUM_PRICE : true;
  if (kind === "skin" && !pricesAvailable) return (item as SkinItem).levelCount >= 5;
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
  knifeRow: SkinItem[];
  gridPages: SkinItem[][];
  totalSelected: number;
  truncated: number;
}

export function paginate(selected: SkinItem[]): Pages {
  const knives = selected.filter((s) => s.isKnife);
  const guns = selected.filter((s) => !s.isKnife);
  const knifeRow = knives.slice(0, KNIFE_ROW_MAX);
  const gridItems = [...guns, ...knives.slice(KNIFE_ROW_MAX)];
  const total = gridItems.length;
  const density = DENSITIES.find((d) => Math.ceil(total / d.capacity) <= 3) ?? DENSITIES[2];
  const shown = gridItems.slice(0, Math.min(total, density.capacity * 3));
  const gridPages: SkinItem[][] = [];
  for (let i = 0; i < shown.length; i += density.capacity) gridPages.push(shown.slice(i, i + density.capacity));
  if (gridPages.length === 0) gridPages.push([]);
  return { density, knifeRow, gridPages, totalSelected: selected.length, truncated: total - shown.length };
}
