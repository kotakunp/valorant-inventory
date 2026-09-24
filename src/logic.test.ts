import { describe, expect, it } from "vitest";
import { buildLoadoutSlots, buildSelection, collectionValue, defaultChecked, groupByGun, gunLabel, isPremiumSkin, LOADOUT_GUNS, paginate, rarityColor, tierInfo, WEAPON_CATEGORIES, WEAPON_ORDER } from "./logic";
import type { CardItem, ShowcasePayload, SkinItem } from "./types";
import { selKey } from "./types";

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

describe("loadout categories", () => {
  it("official loadout order = sidearms → … → heavies (no melee)", () => {
    expect(LOADOUT_GUNS).toEqual([
      "Classic", "Shorty", "Frenzy", "Ghost", "Bandit", "Sheriff",
      "Stinger", "Spectre",
      "Bucky", "Judge",
      "Bulldog", "Guardian", "Phantom", "Vandal",
      "Marshal", "Outlaw", "Operator",
      "Ares", "Odin",
    ]);
    expect(LOADOUT_GUNS).toHaveLength(WEAPON_ORDER.length);
    const flat = WEAPON_CATEGORIES.flatMap((c) => c.guns);
    expect([...flat]).toEqual([...LOADOUT_GUNS]);
  });
});

describe("buildLoadoutSlots", () => {
  const s = (id: string, weaponName: string, isKnife = false) =>
    skin({ id, weaponName, isKnife });

  it("always includes every official gun (empty items when unselected)", () => {
    const slots = buildLoadoutSlots([s("1", "Vandal")]);
    expect(slots).toHaveLength(LOADOUT_GUNS.length);
    expect(slots.map((g) => g.label)).toEqual(LOADOUT_GUNS.map((g) => g.toUpperCase()));
    const vandal = slots.find((g) => g.id === "VANDAL")!;
    expect(vandal.items).toHaveLength(1);
    const classic = slots.find((g) => g.id === "CLASSIC")!;
    expect(classic.items).toHaveLength(0);
  });

  it("unknown guns append after official slots", () => {
    const slots = buildLoadoutSlots([s("1", "Mystery Gun")]);
    expect(slots).toHaveLength(LOADOUT_GUNS.length + 1);
    expect(slots.at(-1)!.label).toBe("MYSTERY GUN");
  });
});

describe("paginate", () => {
  const selectAll = (skins: SkinItem[]) =>
    Object.fromEntries(skins.map((s) => [selKey("skin", s.id), true]));

  /** k distinct official guns (first WEAPON_ORDER names), all selected. */
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

  it("always paginates loadout slots (19 guns), not selected-skin count", () => {
    const skins = uniqueGuns(3);
    const p = paginate(skins, selectAll(skins));
    expect(p.gridPages[0]).toHaveLength(LOADOUT_GUNS.length);
    expect(p.density.name).toBe("standard"); // 19 ≤ 20
    expect(p.gridPages).toHaveLength(1);
    const empty = p.gridPages[0].filter((g) => g.items.length === 0);
    expect(empty).toHaveLength(LOADOUT_GUNS.length - 3);
  });

  it("empty selection still shows all empty gun slots", () => {
    const p = paginate([], {});
    expect(p.totalSelected).toBe(0);
    expect(p.gridPages).toHaveLength(1);
    expect(p.gridPages[0]).toHaveLength(LOADOUT_GUNS.length);
    expect(p.gridPages[0].every((g) => g.items.length === 0)).toBe(true);
    expect(p.knifeItems).toHaveLength(0);
  });

  it("stacks many skins of one gun into a single slot", () => {
    const skins = stackOf("Vandal", 40);
    const p = paginate(skins, selectAll(skins));
    expect(p.gridPages).toHaveLength(1);
    expect(p.gridPages[0]).toHaveLength(LOADOUT_GUNS.length);
    const vandal = p.gridPages[0].find((g) => g.id === "VANDAL")!;
    expect(vandal.items).toHaveLength(40);
  });

  it("unknown guns prefer fewest pages (21–32 slots → dense 1 page)", () => {
    const unknowns = Array.from({ length: 5 }, (_, i) => skin({ id: `u${i}`, weaponName: `Reserve Gun ${i}` }));
    const p = paginate(unknowns, selectAll(unknowns));
    expect(p.gridPages[0]).toHaveLength(LOADOUT_GUNS.length + 5);
    expect(p.density.name).toBe("dense"); // 24 ≤ 32 → 1 page
    expect(p.gridPages.length).toBe(1);
    expect(p.truncated).toBe(0);
  });

  it("truncates slots beyond 3 dense pages with note", () => {
    const guns = uniqueGuns(100); // 19 official + 81 unknown = 100 slots
    const p = paginate(guns, selectAll(guns));
    expect(p.density.name).toBe("dense");
    expect(p.gridPages.length).toBe(3);
    expect(p.truncated).toBe(4); // 100 - 96
  });

  it("knives go to knifeItems; gun grid still has all empty/selected slots", () => {
    const knives = uniqueGuns(5, true);
    const p = paginate(knives, selectAll(knives));
    expect(p.gridPages[0]).toHaveLength(LOADOUT_GUNS.length);
    expect(p.gridPages[0].every((g) => g.items.length === 0)).toBe(true);
    expect(p.knifeItems).toHaveLength(5);
    expect(p.totalSelected).toBe(5);
  });

  it("mixed guns + knives split correctly", () => {
    const guns = uniqueGuns(3);
    const knife = skin({ id: "knife1", isKnife: true, weaponName: "Knife" });
    const all = [...guns, knife];
    const p = paginate(all, selectAll(all));
    expect(p.gridPages[0]).toHaveLength(LOADOUT_GUNS.length);
    expect(p.knifeItems).toHaveLength(1);
    expect(p.totalSelected).toBe(4);
    expect(p.gridPages[0].filter((g) => g.items.length > 0)).toHaveLength(3);
  });

  it("unselected skins do not appear in slots", () => {
    const guns = uniqueGuns(2);
    const selection = { [selKey("skin", guns[0].id)]: true, [selKey("skin", guns[1].id)]: false };
    const p = paginate(guns, selection);
    expect(p.totalSelected).toBe(1);
    const withItems = p.gridPages[0].filter((g) => g.items.length > 0);
    expect(withItems).toHaveLength(1);
    expect(withItems[0].items[0].id).toBe(guns[0].id);
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
