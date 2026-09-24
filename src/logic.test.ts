import { describe, expect, it } from "vitest";
import { buildSelection, collectionValue, defaultChecked, groupByGun, gunLabel, isPremiumSkin, paginate, rarityColor, tierInfo, WEAPON_ORDER } from "./logic";
import type { CardItem, ShowcasePayload, SkinItem } from "./types";

const skin = (over: Partial<SkinItem> = {}): SkinItem => ({
  id: over.id ?? "s1", name: "X", weaponName: "Vandal", icon: null, price: null,
  levelCount: 1, variantCount: 0, isKnife: false, equipped: false,
  chromas: [], defaultChromaId: null, ...over,
});
const card = (over: Partial<CardItem> = {}): CardItem =>
  ({ id: "c1", name: "Card", icon: null, price: null, equipped: false, ...over });

describe("defaultChecked", () => {
  it("checks premium (>=1775) skins", () => {
    expect(defaultChecked("skin", skin({ price: 1775 }), true)).toBe(true);
    expect(defaultChecked("skin", skin({ price: 2475 }), true)).toBe(true);
  });
  it("unchecks cheap skins when prices exist", () => {
    expect(defaultChecked("skin", skin({ price: 875 }), true)).toBe(false);
    expect(defaultChecked("card", card({ price: null }), true)).toBe(false);
  });
  it("uses content tier when price is null (storefront map is partial)", () => {
    expect(defaultChecked("skin", skin({ price: null, contentTierRank: 2 }), true)).toBe(true);
    expect(defaultChecked("skin", skin({ price: null, contentTierRank: 3 }), true)).toBe(true);
    expect(defaultChecked("skin", skin({ price: null, contentTierRank: 1 }), true)).toBe(false);
    expect(defaultChecked("skin", skin({ price: null, contentTierRank: 0 }), true)).toBe(false);
  });
  it("uses level fallback when neither price nor content tier is known", () => {
    expect(defaultChecked("skin", skin({ price: null, levelCount: 5 }), true)).toBe(true);
    expect(defaultChecked("skin", skin({ price: null, levelCount: 5 }), false)).toBe(true);
    expect(defaultChecked("skin", skin({ price: null, levelCount: 4 }), true)).toBe(false);
    expect(defaultChecked("skin", skin({ price: null, levelCount: 4 }), false)).toBe(false);
  });
  it("always checks equipped items and priced non-skins", () => {
    expect(defaultChecked("skin", skin({ price: null, equipped: true }), true)).toBe(true);
    expect(defaultChecked("card", card({ price: 375 }), true)).toBe(true);
    expect(defaultChecked("card", card({ price: null }), true)).toBe(false);
  });
});

describe("paginate", () => {
  /** k distinct gun cells (official names for the first 19, unique unknowns after). */
  const uniqueGuns = (k: number, knife = false): SkinItem[] =>
    Array.from({ length: k }, (_, i) =>
      skin({
        id: `i${i}`,
        weaponName: knife ? "Knife" : i < WEAPON_ORDER.length ? WEAPON_ORDER[i] : `Reserve Gun ${i}`,
        isKnife: knife,
      })
    );
  const stackOf = (gun: string, n: number) =>
    Array.from({ length: n }, (_, i) => skin({ id: `${gun}-${i}`, weaponName: gun }));

  it("single page for <= 8 gun cells (comfort, square 4×2)", () => {
    const p = paginate(uniqueGuns(8));
    expect(p.density.name).toBe("comfort");
    expect(p.gridPages.length).toBe(1);
  });
  it("two pages at 9 guns", () => {
    const p = paginate(uniqueGuns(9));
    expect(p.density.name).toBe("comfort");
    expect(p.gridPages.length).toBe(2);
  });
  it("three pages still comfort at 24 guns", () => {
    const p = paginate(uniqueGuns(24));
    expect(p.density.name).toBe("comfort");
    expect(p.gridPages.length).toBe(3);
  });
  it("bumps density to stay within 3 pages", () => {
    const p = paginate(uniqueGuns(25));
    expect(p.density.name).toBe("standard");
    expect(p.gridPages.length).toBe(2);
  });
  it("truncates gun cells beyond 3 dense pages with note", () => {
    const p = paginate(uniqueGuns(100));
    expect(p.density.name).toBe("dense");
    expect(p.gridPages.length).toBe(3);
    expect(p.truncated).toBe(4);
  });
  it("stacks many skins of one gun into a single cell (no extra pages)", () => {
    const p = paginate(stackOf("Vandal", 40));
    expect(p.gridPages.length).toBe(1);
    expect(p.gridPages[0]).toHaveLength(40);
  });
  it("knives go to the bottom-row knifeItems, not the gun grid", () => {
    const p = paginate(uniqueGuns(5, true));
    expect(p.gridPages.flat()).toHaveLength(0);
    expect(p.knifeItems).toHaveLength(5);
    expect(p.totalSelected).toBe(5);
  });
  it("knives-only still yields one empty grid page + knife row items", () => {
    const p = paginate([
      skin({ id: "k1", isKnife: true, weaponName: "Knife" }),
      skin({ id: "k2", isKnife: true, weaponName: "Knife" }),
      skin({ id: "k3", isKnife: true, weaponName: "Knife" }),
    ]);
    expect(p.gridPages.length).toBe(1);
    expect(p.gridPages[0]).toHaveLength(0);
    expect(p.knifeItems).toHaveLength(3);
  });
  it("empty selection yields one empty page", () => {
    const p = paginate([]);
    expect(p.gridPages).toHaveLength(1);
    expect(p.knifeItems).toHaveLength(0);
  });
  it("mixed guns + knives split correctly", () => {
    const p = paginate([
      ...uniqueGuns(3),
      skin({ id: "knife1", isKnife: true, weaponName: "Knife" }),
    ]);
    expect(p.gridPages[0]).toHaveLength(3);
    expect(p.knifeItems).toHaveLength(1);
    expect(p.totalSelected).toBe(4);
  });
});

describe("groupByGun", () => {
  const s = (id: string, weaponName: string, isKnife = false) =>
    skin({ id, weaponName, isKnife });
  it("orders by official loadout (Classic → … → Odin → MELEE)", () => {
    const groups = groupByGun([
      s("1", "Vandal"),
      s("2", "Classic"),
      s("3", "Knife", true),
      s("4", "Odin"),
      s("5", "Sheriff"),
    ]);
    expect(groups.map((g) => g.label)).toEqual(["CLASSIC", "SHERIFF", "VANDAL", "ODIN", "MELEE"]);
  });
  it("matches weapon names case-insensitively", () => {
    expect(gunLabel({ weaponName: "vandal", isKnife: false })).toBe("VANDAL");
    expect(gunLabel({ weaponName: "Sheriff", isKnife: false })).toBe("SHERIFF");
  });
  it("keeps unknown weapons after known order", () => {
    expect(groupByGun([s("1", "Vandal"), s("2", "Mystery Gun"), s("3", "Classic")]).map((g) => g.label)).toEqual(["CLASSIC", "VANDAL", "MYSTERY GUN"]);
  });
});

describe("presentation helpers", () => {
  it("tier names and colors (Episode 5+ numbering)", () => {
    expect(tierInfo(22).name).toBe("ASCENDANT 2");
    expect(tierInfo(24).name).toBe("IMMORTAL 1");
    expect(tierInfo(27).name).toBe("RADIANT");
    expect(tierInfo(19).name).toBe("DIAMOND 2");
    expect(tierInfo(null).name).toBe("UNRANKED");
    expect(tierInfo(0).name).toBe("UNRANKED");
  });
  it("rarity colors by price", () => {
    expect(rarityColor(null)).toBe("#4a5560");
    expect(rarityColor(null, 5)).toBe("#a866ff"); // level-heuristic premium
    expect(rarityColor(null, 4)).toBe("#4a5560");
    expect(rarityColor(875)).toBe("#7fa3c8");
    expect(rarityColor(1775)).toBe("#a866ff");
    expect(rarityColor(2475)).toBe("#e8c860");
  });
  it("rarity colors by content tier when price is null", () => {
    expect(rarityColor(null, 1, 2)).toBe("#a866ff"); // Premium
    expect(rarityColor(null, 1, 4)).toBe("#e8c860"); // Ultra
    expect(rarityColor(null, 1, 0)).toBe("#7fa3c8"); // Select
    expect(rarityColor(null, 1, 1)).toBe("#7fa3c8"); // Deluxe
  });
  it("isPremiumSkin matches selection + footer rule", () => {
    expect(isPremiumSkin({ price: 1775, levelCount: 1 })).toBe(true);
    expect(isPremiumSkin({ price: 875, levelCount: 5 })).toBe(false);
    expect(isPremiumSkin({ price: null, levelCount: 5 })).toBe(true);
    expect(isPremiumSkin({ price: null, levelCount: 4 })).toBe(false);
  });
  it("isPremiumSkin uses content tier when price is null", () => {
    expect(isPremiumSkin({ price: null, levelCount: 1, contentTierRank: 2 })).toBe(true);
    expect(isPremiumSkin({ price: null, levelCount: 1, contentTierRank: 3 })).toBe(true);
    expect(isPremiumSkin({ price: null, levelCount: 1, contentTierRank: 4 })).toBe(true);
    expect(isPremiumSkin({ price: null, levelCount: 1, contentTierRank: 1 })).toBe(false);
    expect(isPremiumSkin({ price: null, levelCount: 1, contentTierRank: 0 })).toBe(false);
    // Real price wins over a premium tier (shouldn't happen, but deterministic).
    expect(isPremiumSkin({ price: 875, levelCount: 1, contentTierRank: 3 })).toBe(false);
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
