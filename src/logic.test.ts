import { describe, expect, it } from "vitest";
import { buildSelection, collectionValue, defaultChecked, paginate, rarityColor, tierInfo } from "./logic";
import type { CardItem, ShowcasePayload, SkinItem } from "./types";

const skin = (over: Partial<SkinItem> = {}): SkinItem => ({
  id: over.id ?? "s1", name: "X", weaponName: "Vandal", icon: null, price: null,
  levelCount: 1, variantCount: 0, isKnife: false, equipped: false, ...over,
});
const card = (over: Partial<CardItem> = {}): CardItem =>
  ({ id: "c1", name: "Card", icon: null, price: null, equipped: false, ...over });

describe("defaultChecked", () => {
  it("checks premium (>=1775) skins", () => {
    expect(defaultChecked("skin", skin({ price: 1775 }), true)).toBe(true);
    expect(defaultChecked("skin", skin({ price: 2475 }), true)).toBe(true);
  });
  it("unchecks cheap and battlepass skins when prices exist", () => {
    expect(defaultChecked("skin", skin({ price: 875 }), true)).toBe(false);
    expect(defaultChecked("skin", skin({ price: null }), true)).toBe(false);
  });
  it("uses level fallback when prices unavailable", () => {
    expect(defaultChecked("skin", skin({ price: null, levelCount: 5 }), false)).toBe(true);
    expect(defaultChecked("skin", skin({ price: null, levelCount: 4 }), false)).toBe(false);
  });
  it("always checks equipped items and priced non-skins", () => {
    expect(defaultChecked("skin", skin({ price: null, equipped: true }), true)).toBe(true);
    expect(defaultChecked("card", card({ price: 375 }), true)).toBe(true);
    expect(defaultChecked("card", card({ price: null }), true)).toBe(false);
  });
});

describe("paginate", () => {
  const n = (k: number, knife = false) => Array.from({ length: k }, (_, i) => skin({ id: `i${i}`, isKnife: knife }));
  it("single page for <= 20 items (comfort)", () => {
    const p = paginate(n(20));
    expect(p.density.name).toBe("comfort");
    expect(p.gridPages.length).toBe(1);
  });
  it("two pages at 21", () => {
    const p = paginate(n(21));
    expect(p.density.name).toBe("comfort");
    expect(p.gridPages.length).toBe(2);
  });
  it("bumps density to stay within 3 pages", () => {
    const p = paginate(n(80));
    expect(p.density.name).toBe("dense");
    expect(p.gridPages.length).toBe(2);
  });
  it("truncates beyond 120 with note", () => {
    const p = paginate(n(130));
    expect(p.gridPages.length).toBe(3);
    expect(p.truncated).toBe(10);
  });
  it("knives: first 8 in row, overflow into grid", () => {
    const p = paginate([...n(10, true)]);
    expect(p.knifeRow.length).toBe(8);
    expect(p.gridPages[0].length).toBe(2);
  });
  it("knives-only still yields one page", () => {
    const p = paginate(n(3, true));
    expect(p.knifeRow.length).toBe(3);
    expect(p.gridPages.length).toBe(1);
    expect(p.gridPages[0].length).toBe(0);
  });
  it("empty selection yields one empty page", () => {
    expect(paginate([]).gridPages).toHaveLength(1);
  });
});

describe("presentation helpers", () => {
  it("tier names and colors", () => {
    expect(tierInfo(22).name).toBe("IMMORTAL 2");
    expect(tierInfo(24).name).toBe("RADIANT");
    expect(tierInfo(null).name).toBe("UNRANKED");
  });
  it("rarity colors by price", () => {
    expect(rarityColor(null)).toBe("#4a5560");
    expect(rarityColor(875)).toBe("#7fa3c8");
    expect(rarityColor(1775)).toBe("#a866ff");
    expect(rarityColor(2475)).toBe("#e8c860");
  });
  it("selection + collection value", () => {
    const payload = {
      puuid: "p", gameName: "G", tagLine: "T", region: "na",
      accountLevel: 1, ranks: { current: null, peak: null }, wallet: { vp: null, rp: null },
      skins: [skin({ id: "a", price: 1775 }), skin({ id: "b", price: 875 })],
      cards: [card({ id: "c", price: 375 })],
      titles: [], buddies: [], pricesAvailable: true, generatedAt: "2026-09-23",
    } as ShowcasePayload;
    const sel = buildSelection(payload);
    expect(sel["skin:a"]).toBe(true);
    expect(sel["skin:b"]).toBe(false);
    expect(sel["card:c"]).toBe(true);
    expect(collectionValue(payload, sel)).toBe(1775 + 375);
  });
});
