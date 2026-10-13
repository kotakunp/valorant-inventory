import type { AgentItem, BuddyItem, CardItem, ItemKind, Selection, ShowcasePayload, SkinItem, TitleItem } from "./types";
import { selKey } from "./types";

export const PREMIUM_PRICE = 1775;
export const MAX_GRID_ITEMS = 120;

/** Gap between a trigger and its floating peek, and the viewport inset. */
export const PEEK_GAP = 8;
export const PEEK_INSET = 12;

/** Minimal geometry the peek placement needs (DOMRect satisfies it). */
export interface RectLike {
  left: number;
  top: number;
  right: number;
  width: number;
}

/**
 * Where to put a floating peek panel of `size` for a trigger at `rect`: beside
 * it on the right when that fits, else on the left, else centred over it —
 * always clamped inside the viewport. Shared by the store-card peek
 * (`StorePanel.tsx`) and the sidebar card peek (`App.tsx`).
 */
export function peekPosition(
  rect: RectLike,
  size: { width: number; height: number },
  viewport: { width: number; height: number }
): { left: number; top: number } {
  const left =
    viewport.width - rect.right >= size.width + PEEK_GAP * 2
      ? rect.right + PEEK_GAP
      : rect.left >= size.width + PEEK_GAP * 2
        ? rect.left - size.width - PEEK_GAP
        : Math.max(
            PEEK_INSET,
            Math.min(rect.left + rect.width / 2 - size.width / 2, viewport.width - size.width - PEEK_INSET)
          );
  const top = Math.max(PEEK_INSET, Math.min(rect.top, viewport.height - size.height - PEEK_INSET));
  return { left, top };
}

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
 * Combined columns use section labels mid-column (SMGS then SHOTGUNS, etc.).
 * Flat gun list still follows official loadout order.
 */
export const WEAPON_CATEGORIES = [
  {
    id: "sidearms",
    sections: [{ label: "SIDEARMS", guns: ["Classic", "Shorty", "Frenzy", "Ghost", "Bandit", "Sheriff"] }],
  },
  {
    id: "smgs-shotguns",
    sections: [
      { label: "SMGS", guns: ["Stinger", "Spectre"] },
      { label: "SHOTGUNS", guns: ["Bucky", "Judge"] },
    ],
  },
  {
    id: "rifles",
    sections: [{ label: "RIFLES", guns: ["Bulldog", "Guardian", "Phantom", "Vandal"] }],
  },
  {
    id: "snipers-heavies",
    sections: [
      { label: "SNIPERS", guns: ["Marshal", "Outlaw", "Operator"] },
      { label: "HEAVIES", guns: ["Ares", "Odin"] },
    ],
  },
] as const;

export type WeaponCategory = (typeof WEAPON_CATEGORIES)[number];
export type WeaponSection = WeaponCategory["sections"][number];

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

export type AnyItem = SkinItem | CardItem | TitleItem | BuddyItem | AgentItem;

export function defaultChecked(kind: ItemKind, item: AnyItem, pricesAvailable: boolean): boolean {
  void pricesAvailable; // price-map coverage is partial; null price always uses the level heuristic for skins
  if (kind === "agent") return false; // "main agent" defaults come from the profile, not pricing
  // Riot reports neither price nor equip state for buddies, so a price/equip
  // rule would start every account at 0 buddies.
  if (kind === "buddy") return true;
  if (item.equipped) return true;
  if (kind === "skin") return isPremiumSkin(item as SkinItem);
  return item.price != null;
}

/** The owned agent with the most games in the profile window, else null. */
export function favoriteAgent(payload: ShowcasePayload): AgentItem | null {
  const favId = payload.profile?.window?.topAgents?.[0]?.id;
  if (!favId) return null;
  return (payload.agents ?? []).find((a) => a.id === favId) ?? null;
}

export function buildSelection(payload: ShowcasePayload): Selection {
  const sel: Selection = {};
  const add = (kind: ItemKind, item: AnyItem) => {
    sel[selKey(kind, item.id)] = defaultChecked(kind, item, payload.pricesAvailable);
  };
  payload.skins.forEach((i) => add("skin", i));
  payload.buddies.forEach((i) => add("buddy", i));
  // Cards/titles/agents hold ONE slot each on the showcase: default to a single
  // pick (equipped first, else the first qualifying item; the agent defaults to
  // the most-played one) so the sidebar starts radio-clean instead of showing
  // several checkmarks that the preview resolves down to one anyway.
  Object.assign(sel, pickSingleSlot("card", payload.cards, (i) => defaultChecked("card", i, payload.pricesAvailable)));
  Object.assign(sel, pickSingleSlot("title", payload.titles, (i) => defaultChecked("title", i, payload.pricesAvailable)));
  const fav = favoriteAgent(payload);
  for (const a of payload.agents ?? []) sel[selKey("agent", a.id)] = a.id === fav?.id;
  return sel;
}

/**
 * One-slot kinds (card/title): collapse `items` to the single item that should
 * be checked — the equipped one when any qualifies, else the first that does —
 * and write that choice into `sel` (every other slot of the kind cleared).
 * Used by `buildSelection` (defaults) and by `setSection`'s all/premium modes.
 */
export function pickSingleSlot(
  kind: ItemKind,
  items: AnyItem[],
  qualifies: (item: AnyItem) => boolean,
  sel: Selection = {}
): Selection {
  const pick = items.find((i) => i.equipped && qualifies(i)) ?? items.find(qualifies) ?? null;
  const out: Selection = { ...sel };
  for (const i of items) out[selKey(kind, i.id)] = i === pick;
  return out;
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

/** List-price VP of every owned skin, card, title and buddy, selected or not. */
export function accountValue(payload: ShowcasePayload): number {
  if (payload.accountValue != null) return payload.accountValue;
  return [...payload.skins, ...payload.cards, ...payload.titles, ...payload.buddies].reduce((n, i) => n + (i.price ?? 0), 0);
}

/** Estimate USD for VP at the base tier (1,000 VP = $9.99), whole dollars. */
export function vpToUsd(vp: number): number {
  return Math.round(vp * 0.00999);
}

/** Whole-percent winrate; null when there are no games. */
export function winratePct(wins: number, games: number): number | null {
  return games > 0 ? Math.round((wins / games) * 100) : null;
}

/** Compact relative time for match rows ("just now" … "6d ago" … "Mar 4"). */
export function relTime(iso: string, now = Date.now()): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const minutes = Math.floor(Math.max(0, now - t) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(t));
}

/** Match length as "mm:ss" (null when the details carried no duration). */
export function matchDuration(ms: number | null): string | null {
  if (ms == null || ms <= 0) return null;
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
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

/* ===== Peek stack layout (§13–§16) ===== */

export interface PeekOptions {
  /** Size of one skin's box along the stack axis, as a fraction of the area. */
  box: number;
  /** Largest gap between neighbouring skins (fraction of the area). */
  maxStep: number;
  /** Smallest gap that still leaves a readable strip; deeper skins are dropped. */
  minStep: number;
}

export interface PeekStack {
  box: number;
  /** Distance between neighbouring skins along the axis. */
  step: number;
  /** Front-first offsets from the front edge (index 0 = foremost, fully visible). */
  offsets: number[];
  /** Skins that did not fit (deepest first to go); the spread still lists them. */
  hidden: number;
}

/**
 * One-axis stack: the foremost skin sits at the front edge and every skin
 * behind it is pushed one `step` further away, so each back skin shows the
 * strip nearest that direction (gun cells: the top edge; melee band: the
 * blade/head side). The group is centred and never leaves the area.
 */
export function peekStack(count: number, { box, maxStep, minStep }: PeekOptions): PeekStack {
  const n = Math.max(0, Math.floor(count));
  if (n === 0) return { box, step: 0, offsets: [], hidden: 0 };
  const room = Math.max(0, 1 - box);
  const visible = n === 1 ? 1 : Math.min(n, 1 + Math.floor(room / minStep + 1e-9));
  const step = visible > 1 ? Math.min(maxStep, room / (visible - 1)) : 0;
  const base = (1 - (box + (visible - 1) * step)) / 2;
  return {
    box,
    step,
    offsets: Array.from({ length: visible }, (_, i) => base + i * step),
    hidden: n - visible,
  };
}

export interface GunStack {
  /** Skins drawn (front-first); deeper ones are left to the hover spread. */
  visible: number;
  hidden: number;
  /** How much of each back skin shows above the one in front, as a share of the art's own height. */
  peek: number;
  /** Height of each skin's fit box (fraction of the cell) so the whole group always fits. */
  box: number;
  /** Per skin, front-first: vertical shift as a share of the art's own height (+ = down). */
  shifts: number[];
}

/**
 * Most of a back skin a gun stack may reveal when the cell has spare height
 * (the stack spreads out to fill the cell but neighbours always overlap).
 */
export const GUN_SPREAD_MAX = 0.75;

/** Most skins one gun cell draws; past this the strips get too thin to read. */
export const GUN_STACK_MAX = 9;

/**
 * Gun cell: the group is centred in the cell. Each skin behind the front one
 * sits one `peek` (a share of the art's own height, so it reads the same for
 * every gun shape) higher, showing its top edge; the front skin moves down by
 * the same amount, so the group stays centred. Few skins show a big slice of
 * each back skin; the slice shrinks as the stack grows, and the fit box
 * shrinks so the group never leaves its cell.
 */
export function gunStack(count: number): GunStack {
  const n = Math.max(0, Math.floor(count));
  const visible = Math.min(n, GUN_STACK_MAX);
  const peek = visible <= 1 ? 0 : Math.max(0.14, 0.62 - 0.07 * visible);
  const span = 1 + (visible - 1) * peek;
  return {
    visible,
    hidden: n - visible,
    peek,
    box: visible <= 1 ? 1 : 1 / span,
    shifts: Array.from({ length: visible }, (_, i) => ((visible - 1) / 2 - i) * peek),
  };
}

/**
 * Share of its column a gun cell claims (flex-grow), by how many skins it
 * stacks: empty and light cells give up height so big stacks in the same
 * column get taller (and their art can grow). Bounded so a light cell stays
 * readable. Never below 1: a lone flex item with grow < 1 would not fill its column.
 */
export function cellWeight(count: number): number {
  const n = Math.max(0, Math.floor(count));
  if (n === 0) return 1;
  if (n <= 2) return 1.25;
  return Math.min(3, 1.25 + 0.25 * (Math.min(n, GUN_STACK_MAX) - 2));
}

export interface KnifeLayout {
  rows: number;
  /** Knife box width (fraction of the band width); height is one row. */
  box: number;
  /** Per knife, front-first: row and left edge (fraction of the band width). */
  slots: { row: number; left: number }[];
}

/** Melee band tiers by knife count: rows and knife width (fraction of the band width). */
const KNIFE_TIERS: { upTo: number; rows: number; box: number }[] = [
  { upTo: 3, rows: 1, box: 0.32 },
  { upTo: 5, rows: 1, box: 0.22 },
  { upTo: 7, rows: 1, box: 0.19 },
  { upTo: 16, rows: 2, box: 0.17 },
  { upTo: Infinity, rows: 3, box: 0.14 },
];

/** Share of a knife's width its neighbour always covers when there is room (a slight overlap). */
const KNIFE_OVERLAP = 0.2;

/**
 * Melee band: a horizontal peek stack per row, the gun stack turned sideways.
 * The foremost knife sits on the right and each knife behind it is pushed one
 * step left, showing its left part (knife renders put the blade/head on the
 * left). Neighbours overlap slightly; the overlap only grows once the row is
 * full. More knives shrink a tier and wrap into up to three rows. The group is
 * centred and never leaves the band.
 */
export function knifeLayout(count: number): KnifeLayout {
  const n = Math.max(0, Math.floor(count));
  const { rows: maxRows, box } = KNIFE_TIERS.find((t) => n <= t.upTo)!;
  const rows = Math.max(1, Math.min(maxRows, n));
  const perRow = Math.max(1, Math.ceil(n / rows));
  const slots: KnifeLayout["slots"] = [];
  for (let r = 0; r < rows; r++) {
    const inRow = Math.max(0, Math.min(perRow, n - r * perRow));
    const st = peekStack(inRow, { box, maxStep: box * (1 - KNIFE_OVERLAP), minStep: 0.005 });
    // peekStack offsets grow away from the front; mirror them so the front is rightmost
    st.offsets.forEach((offset) => slots.push({ row: r, left: 1 - offset - box }));
  }
  return { rows, box, slots };
}

/** Rarity-ish score for deterministic stack ordering (higher = nearer the front). */
export function skinTierScore(s: Pick<SkinItem, "price" | "levelCount" | "contentTierRank">): number {
  if (s.price != null) return s.price;
  if (s.contentTierRank != null) return s.contentTierRank * 600;
  return s.levelCount * 100;
}

/**
 * Front-first stack order (§15/§16): manual front override → equipped →
 * tier score → stable original order.
 */
export function orderStack(items: SkinItem[], frontId?: string): SkinItem[] {
  if (items.length <= 1) return items.slice();
  const front = frontId ? items.find((s) => s.id === frontId) : undefined;
  const rest = front ? items.filter((s) => s.id !== frontId) : items;
  const ranked = rest
    .map((s, i) => ({ s, i }))
    .sort((a, b) => {
      const eq = (b.s.equipped ? 1 : 0) - (a.s.equipped ? 1 : 0);
      if (eq !== 0) return eq;
      const sc = skinTierScore(b.s) - skinTierScore(a.s);
      if (sc !== 0) return sc;
      return a.i - b.i;
    })
    .map((r) => r.s);
  return front ? [front, ...ranked] : ranked;
}

/** Rarity label matching rarityColor buckets (menu + docs wording). */
export function rarityLabel(
  price: number | null,
  levelCount = 0,
  contentTierRank: number | null = null
): string {
  const c = rarityColor(price, levelCount, contentTierRank);
  if (c === "#e8c860") return "ULTRA";
  if (c === "#a866ff") return "PREMIUM";
  if (c === "#7fa3c8") return "SELECT";
  return "STANDARD";
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
