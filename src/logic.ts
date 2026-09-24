import type { BuddyItem, CardItem, ItemKind, Selection, ShowcasePayload, SkinItem, TitleItem } from "./types";
import { selKey } from "./types";

export const PREMIUM_PRICE = 1775;
export const MAX_GRID_ITEMS = 120;

/** Content-tier ranks ≥ this are "premium" (Premium Edition=2, Exclusive=3, Ultra=4). */
export const PREMIUM_TIER = 2;

/**
 * Premium skin: VP ≥ 1775 when priced; else content tier ≥ Premium (storefront often
 * omits prices); else no price + ≥ 5 levels. Shared with defaultChecked/footer count.
 */
export function isPremiumSkin(
  s: Pick<SkinItem, "price" | "levelCount" | "contentTierRank">
): boolean {
  if (s.price != null) return s.price >= PREMIUM_PRICE;
  if (s.contentTierRank != null) return s.contentTierRank >= PREMIUM_TIER;
  return s.levelCount >= 5;
}

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

/**
 * Showcase column groups (exactly 4 + optional OTHER).
 * Flat gun list still follows official loadout order.
 */
export const WEAPON_CATEGORIES = [
  { id: "sidearms", label: "SIDEARMS", guns: ["Classic", "Shorty", "Frenzy", "Ghost", "Bandit", "Sheriff"] },
  { id: "smgs-shotguns", label: "SMGS · SHOTGUNS", guns: ["Stinger", "Spectre", "Bucky", "Judge"] },
  { id: "rifles", label: "RIFLES", guns: ["Bulldog", "Guardian", "Phantom", "Vandal"] },
  { id: "snipers-heavies", label: "SNIPERS · HEAVIES", guns: ["Marshal", "Outlaw", "Operator", "Ares", "Odin"] },
] as const;

/** Flat gun list in official loadout category order (excludes melee). */
export const LOADOUT_GUNS: readonly string[] = WEAPON_ORDER;

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

/**
 * Always one slot per official loadout gun (empty `items` = empty rectangle),
 * then any unknown guns that have selected skins.
 */
export function buildLoadoutSlots(gunsOnly: SkinItem[]): GunGroup[] {
  const byId = new Map(groupByGun(gunsOnly).map((g) => [g.id, g]));
  const official = new Set(LOADOUT_GUNS.map((w) => w.toUpperCase()));
  const out: GunGroup[] = LOADOUT_GUNS.map((w) => {
    const id = w.toUpperCase();
    return byId.get(id) ?? { id, label: id, items: [] };
  });
  for (const g of groupByGun(gunsOnly)) {
    if (!official.has(g.id)) out.push(g);
  }
  return out;
}

export type AnyItem = SkinItem | CardItem | TitleItem | BuddyItem;

export function defaultChecked(kind: ItemKind, item: AnyItem, pricesAvailable: boolean): boolean {
  void pricesAvailable; // price-map coverage is partial; null price always uses the level heuristic for skins
  if (item.equipped) return true;
  if (kind === "skin") return isPremiumSkin(item as SkinItem);
  return item.price != null;
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

export function rarityColor(
  price: number | null,
  levelCount = 0,
  contentTierRank: number | null = null
): string {
  if (price != null) {
    if (price >= 2475) return "#e8c860";
    if (price >= PREMIUM_PRICE) return "#a866ff";
    return "#7fa3c8";
  }
  if (contentTierRank != null) {
    if (contentTierRank >= 4) return "#e8c860";
    if (contentTierRank >= PREMIUM_TIER) return "#a866ff";
    return "#7fa3c8";
  }
  return isPremiumSkin({ price, levelCount, contentTierRank }) ? "#a866ff" : "#4a5560";
}

/** Episode 5+ competitive tiers (Ascendant inserted): from = first tier index of that rank. */
const BRACKETS: { name: string; from: number; color: string }[] = [
  { name: "Radiant", from: 27, color: "#fff3c4" },
  { name: "Immortal", from: 24, color: "#ff5c73" },
  { name: "Ascendant", from: 21, color: "#2ee6a8" },
  { name: "Diamond", from: 18, color: "#b49bff" },
  { name: "Platinum", from: 15, color: "#5fd8e6" },
  { name: "Gold", from: 12, color: "#e8c860" },
  { name: "Silver", from: 9, color: "#c0c0c0" },
  { name: "Bronze", from: 6, color: "#b87333" },
  { name: "Iron", from: 3, color: "#8a8a8a" },
];

export function tierInfo(tier: number | null): { name: string; color: string } {
  // 0 = UNRANKED; 1–2 are unused slots in the tier table.
  if (tier == null || tier < 3) return { name: "UNRANKED", color: "#8B97A0" };
  const b = BRACKETS.find((x) => tier >= x.from);
  if (!b) return { name: "UNRANKED", color: "#8B97A0" };
  if (b.name === "Radiant") return { name: "RADIANT", color: b.color };
  return { name: `${b.name.toUpperCase()} ${tier - b.from + 1}`, color: b.color };
}

export const DENSITIES = [
  { name: "comfort", cols: 4, rows: 4, capacity: 16 },
  { name: "standard", cols: 5, rows: 4, capacity: 20 },
  { name: "dense", cols: 8, rows: 4, capacity: 32 },
] as const;

export type Density = (typeof DENSITIES)[number];

export interface Pages {
  density: Density;
  /** Loadout gun slots (empty items allowed), chunked by density capacity. */
  gridPages: GunGroup[][];
  /** All selected knives — always rendered on the full-width bottom row. */
  knifeItems: SkinItem[];
  totalSelected: number;
  truncated: number;
}

/** Prefer fewest pages (1 → 2 → 3); fall back to dense (then truncate). */
function pickDensity(n: number): Density {
  return (
    DENSITIES.find((d) => Math.ceil(n / d.capacity) <= 1) ??
    DENSITIES.find((d) => Math.ceil(n / d.capacity) <= 2) ??
    DENSITIES.find((d) => Math.ceil(n / d.capacity) <= 3) ??
    DENSITIES[2]
  );
}

/**
 * Build showcase pages from the full inventory + selection.
 * Always includes every official loadout gun as a slot (empty = blank cell).
 */
export function paginate(allSkins: SkinItem[], selection: Selection): Pages {
  const selected = allSkins.filter((s) => selection[selKey("skin", s.id)]);
  const total = selected.length;
  const knifeItems = selected.filter((s) => s.isKnife);
  const gunsOnly = selected.filter((s) => !s.isKnife);
  const slots = buildLoadoutSlots(gunsOnly);
  const density = pickDensity(slots.length);
  const cap = density.capacity;
  const maxCells = cap * 3;

  let truncated = 0;
  let kept = slots;
  if (slots.length > maxCells) {
    truncated = slots.slice(maxCells).reduce((n, g) => n + g.items.length, 0);
    kept = slots.slice(0, maxCells);
  }

  const gridPages: GunGroup[][] = [];
  for (let i = 0; i < kept.length; i += cap) {
    gridPages.push(kept.slice(i, i + cap));
  }
  if (gridPages.length === 0) gridPages.push([]);
  return { density, gridPages, knifeItems, totalSelected: total, truncated };
}
