import { describe, expect, it } from "vitest";
import { buildLoadoutSlots, buildSelection, cellWeight, collectionValue, defaultChecked, favoriteAgent, groupByGun, gunLabel, isPremiumSkin, LOADOUT_GUNS, matchDuration, orderStack, paginate, peekPosition, pickSingleSlot, rarityColor, rarityLabel, relTime, skinTierScore, gunStack, GUN_STACK_MAX, knifeLayout, peekStack, tierInfo, vpToUsd, winratePct, WEAPON_CATEGORIES, WEAPON_ORDER } from "./logic";
import type { AnyItem } from "./logic";
import type { AgentItem, CardItem, ProfileStats, ShowcasePayload, SkinItem, TitleItem } from "./types";
import { isSingleSlot, selKey } from "./types";

const skin = (over: Partial<SkinItem> = {}): SkinItem => ({
  id: over.id ?? "s1", name: "X", weaponName: "Vandal", icon: null, price: null,
  levelCount: 1, variantCount: 0, isKnife: false, equipped: false,
  chromas: [], defaultChromaId: null, ...over,
});
const card = (over: Partial<CardItem> = {}): CardItem =>
  ({ id: "c1", name: "Card", icon: null, price: null, equipped: false, ...over });
const title = (over: Partial<TitleItem> = {}): TitleItem =>
  ({ id: "t1", name: "Title", text: "T", price: null, equipped: false, ...over });

describe("isSingleSlot", () => {
  it("treats card, title + agent as single slots (the showcase renders one of each)", () => {
    expect(isSingleSlot("card")).toBe(true);
    expect(isSingleSlot("title")).toBe(true);
    expect(isSingleSlot("agent")).toBe(true);
  });
  it("leaves skins and buddies multi-select", () => {
    expect(isSingleSlot("skin")).toBe(false);
    expect(isSingleSlot("buddy")).toBe(false);
  });
});

describe("pickSingleSlot", () => {
  const cards = [
    card({ id: "c1", price: 375 }),
    card({ id: "c2", price: null }),
    card({ id: "c3", price: 875, equipped: true }),
  ];
  const qualifies = (i: AnyItem) => i.equipped || i.price != null;

  it("checks exactly one item: equipped wins over the first qualifying", () => {
    expect(pickSingleSlot("card", cards, qualifies)).toEqual({
      "card:c1": false,
      "card:c2": false,
      "card:c3": true,
    });
  });

  it("falls back to the first qualifying item when none is equipped", () => {
    expect(pickSingleSlot("card", [cards[0], cards[1]], qualifies)).toEqual({
      "card:c1": true,
      "card:c2": false,
    });
  });

  it("clears every slot of the kind when nothing qualifies", () => {
    const sel = pickSingleSlot("card", cards, (i) => i.price != null && i.price > 5000);
    expect(Object.keys(sel)).toHaveLength(cards.length);
    expect(Object.values(sel)).toEqual([false, false, false]);
  });

  it("merges over the existing selection without touching other kinds", () => {
    const sel = pickSingleSlot(
      "title",
      [title({ id: "t1" }), title({ id: "t2", equipped: true })],
      () => true,
      { "skin:s1": true }
    );
    expect(sel).toEqual({ "skin:s1": true, "title:t1": false, "title:t2": true });
  });
});

describe("buildSelection single-slot defaults", () => {
  const payload = (cards: CardItem[], titles: TitleItem[]) =>
    ({
      puuid: "p", gameName: "G", tagLine: "T", region: "na",
      accountLevel: 1, ranks: { current: null, peak: null }, wallet: { vp: null, rp: null },
      skins: [], cards, titles, buddies: [], pricesAvailable: true, generatedAt: "2026-10-02",
    }) as ShowcasePayload;

  it("keeps at most one card and one title checked (equipped first)", () => {
    const sel = buildSelection(
      payload(
        [card({ id: "c1", price: 375 }), card({ id: "c2", price: 1775 }), card({ id: "c3", price: null, equipped: true })],
        [title({ id: "t1", price: 300 }), title({ id: "t2", equipped: true })]
      )
    );
    expect(Object.entries(sel).filter(([, v]) => v)).toEqual([
      ["card:c3", true],
      ["title:t2", true],
    ]);
  });

  it("checks every owned buddy by default (Riot sends no buddy price or equip state)", () => {
    const sel = buildSelection({
      ...payload([], []),
      buddies: [{ id: "b1", name: "B1", icon: null, price: null, equipped: false }],
    } as ShowcasePayload);
    expect(sel["buddy:b1"]).toBe(true);
  });

  it("picks the first qualifying card when none is equipped", () => {
    const sel = buildSelection(payload([card({ id: "c1", price: null }), card({ id: "c2", price: 375 })], []));
    expect(sel["card:c1"]).toBe(false);
    expect(sel["card:c2"]).toBe(true);
  });

  it("leaves both slots empty when no card or title qualifies", () => {
    const sel = buildSelection(payload([card({ id: "c1", price: null })], [title({ id: "t1", price: null })]));
    expect(sel["card:c1"]).toBe(false);
    expect(sel["title:t1"]).toBe(false);
  });
});

describe("peekPosition", () => {
  const rect = (left: number, top: number, width = 200, height = 200) => ({
    left, top, right: left + width, width,
  });
  const size = { width: 300, height: 400 };
  const viewport = { width: 1280, height: 900 };

  it("sits to the right of the trigger when that fits", () => {
    expect(peekPosition(rect(400, 300), size, viewport)).toEqual({ left: 608, top: 300 });
  });

  it("flips to the left when the right side would overflow", () => {
    expect(peekPosition(rect(1000, 300), size, viewport)).toEqual({ left: 692, top: 300 });
  });

  it("centres over the trigger and clamps when neither side fits", () => {
    // Wide trigger with <316px of viewport either side → centred over it.
    expect(peekPosition(rect(300, 300, 700), size, viewport)).toEqual({ left: 500, top: 300 });
    // Same trigger in a 700px viewport: centring would overflow → clamped.
    expect(peekPosition(rect(300, 300, 700), size, { width: 700, height: 900 }).left).toBe(388);
  });

  it("keeps the panel inside the viewport vertically", () => {
    expect(peekPosition(rect(400, 800), size, viewport).top).toBe(900 - 400 - 12);
    expect(peekPosition(rect(400, -50), size, viewport).top).toBe(12);
  });
});

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
  const allSectionGuns = (cat: (typeof WEAPON_CATEGORIES)[number]) =>
    cat.sections.flatMap((s) => [...s.guns]);

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
    const flat = WEAPON_CATEGORIES.flatMap(allSectionGuns);
    expect([...flat]).toEqual([...LOADOUT_GUNS]);
  });
  it("showcase uses exactly 4 columns with mid-column section titles", () => {
    expect(WEAPON_CATEGORIES).toHaveLength(4);
    expect(WEAPON_CATEGORIES.map((c) => c.id)).toEqual([
      "sidearms",
      "smgs-shotguns",
      "rifles",
      "snipers-heavies",
    ]);
    const smgShot = WEAPON_CATEGORIES[1].sections;
    expect(smgShot.map((s) => s.label)).toEqual(["SMGS", "SHOTGUNS"]);
    expect(smgShot[0].guns).toEqual(["Stinger", "Spectre"]);
    expect(smgShot[1].guns).toEqual(["Bucky", "Judge"]);
    const snipHeavy = WEAPON_CATEGORIES[3].sections;
    expect(snipHeavy.map((s) => s.label)).toEqual(["SNIPERS", "HEAVIES"]);
    expect(snipHeavy[0].guns).toEqual(["Marshal", "Outlaw", "Operator"]);
    expect(snipHeavy[1].guns).toEqual(["Ares", "Odin"]);
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

describe("stack layout", () => {
  it("gun stacks stay centred and inside their cell for any count", () => {
    for (const n of [1, 2, 3, 5, 8, 9, 15, 80]) {
      const st = gunStack(n);
      expect(st.visible + st.hidden).toBe(n);
      expect(st.visible).toBeLessThanOrEqual(GUN_STACK_MAX);
      // centred: shifts are symmetric around 0
      const sum = st.shifts.reduce((x, y) => x + y, 0);
      expect(sum).toBeCloseTo(0, 10);
      // group height (in fit-box units) never exceeds the cell
      expect(st.box * (1 + (st.visible - 1) * st.peek)).toBeLessThanOrEqual(1 + 1e-9);
      // front-first: each back skin sits exactly one peek higher
      for (let i = 1; i < st.shifts.length; i++) expect(st.shifts[i - 1] - st.shifts[i]).toBeCloseTo(st.peek, 10);
    }
  });

  it("single gun skin is centred at full size", () => {
    expect(gunStack(1)).toEqual({ visible: 1, hidden: 0, peek: 0, box: 1, shifts: [0] });
  });

  it("small stacks reveal more of each back skin than big ones", () => {
    expect(gunStack(2).peek).toBeGreaterThan(gunStack(3).peek);
    expect(gunStack(3).peek).toBeGreaterThan(gunStack(5).peek);
    expect(gunStack(5).peek).toBeGreaterThan(gunStack(8).peek);
    expect(gunStack(3).peek).toBeGreaterThanOrEqual(0.4);
    expect(gunStack(20).hidden).toBe(20 - GUN_STACK_MAX);
  });

  it("cellWeight: light cells give up height to big stacks, within bounds", () => {
    expect(cellWeight(0)).toBeLessThan(cellWeight(1));
    expect(cellWeight(1)).toBe(cellWeight(2));
    expect(cellWeight(2)).toBeLessThan(cellWeight(3));
    expect(cellWeight(3)).toBeLessThan(cellWeight(8));
    expect(cellWeight(GUN_STACK_MAX)).toBe(cellWeight(40));
    expect(cellWeight(40) / cellWeight(0)).toBeLessThanOrEqual(3);
    expect(cellWeight(0)).toBeGreaterThanOrEqual(1);
  });

  it("melee band places every knife inside the band in size tiers", () => {
    for (const n of [0, 1, 3, 5, 8, 9, 14, 16, 17, 24, 40]) {
      const l = knifeLayout(n);
      expect(l.slots).toHaveLength(n);
      for (const s of l.slots) {
        expect(s.row).toBeLessThan(l.rows);
        expect(s.left).toBeGreaterThanOrEqual(-1e-9);
        expect(s.left + l.box).toBeLessThanOrEqual(1 + 1e-9);
      }
    }
    expect(knifeLayout(3)).toMatchObject({ rows: 1 });
    expect(knifeLayout(7)).toMatchObject({ rows: 1 });
    expect(knifeLayout(14)).toMatchObject({ rows: 2 });
    expect(knifeLayout(30)).toMatchObject({ rows: 3 });
    // sizes step down: few knives are big, many are smaller
    expect(knifeLayout(2).box).toBeGreaterThan(knifeLayout(7).box);
    expect(knifeLayout(7).box).toBeGreaterThan(knifeLayout(12).box);
    // horizontal stack: every knife in a row has its own spot, the front one rightmost,
    // neighbours overlap slightly and always keep well over half a knife visible
    for (const n of [2, 3, 5, 6, 7, 8, 10, 14, 16, 24, 27]) {
      const l = knifeLayout(n);
      for (let r = 0; r < l.rows; r++) {
        const lefts = l.slots.filter((s) => s.row === r).map((s) => s.left);
        for (let i = 1; i < lefts.length; i++) {
          const step = (lefts[i - 1] - lefts[i]) / l.box;
          expect(step).toBeGreaterThan(0.6);
          expect(step).toBeLessThanOrEqual(0.8 + 1e-9);
        }
      }
    }
    expect(peekStack(0, { box: 0.3, maxStep: 0.33, minStep: 0.03 }).offsets).toEqual([]);
  });

  it("orderStack: manual front override wins", () => {
    const items = [
      skin({ id: "a", price: 2475, equipped: true }),
      skin({ id: "b", price: 1775 }),
      skin({ id: "c", price: 875 }),
    ];
    expect(orderStack(items, "c").map((s) => s.id)).toEqual(["c", "a", "b"]);
    expect(orderStack(items, "missing").map((s) => s.id)).toEqual(["a", "b", "c"]);
    expect(orderStack(items).map((s) => s.id)).toEqual(["a", "b", "c"]);
  });

  it("orderStack: equipped > tier score > stable original order", () => {
    const items = [
      skin({ id: "cheap", price: 875 }),
      skin({ id: "premium", price: 2175 }),
      skin({ id: "mid", price: 1275 }),
      skin({ id: "eq", price: 875, equipped: true }),
    ];
    expect(orderStack(items).map((s) => s.id)).toEqual(["eq", "premium", "mid", "cheap"]);
    // stable for equal scores: original order preserved
    const ties = [skin({ id: "t1", price: null, levelCount: 3 }), skin({ id: "t2", price: null, levelCount: 3 })];
    expect(orderStack(ties).map((s) => s.id)).toEqual(["t1", "t2"]);
    // deterministic: same input → same output, and single/empty are returned as-is
    expect(orderStack([skin({ id: "solo" })]).map((s) => s.id)).toEqual(["solo"]);
    expect(orderStack([])).toEqual([]);
  });

  it("skinTierScore: price > content tier > level fallback", () => {
    expect(skinTierScore({ price: 1775, levelCount: 1, contentTierRank: null })).toBe(1775);
    expect(skinTierScore({ price: null, levelCount: 1, contentTierRank: 3 })).toBe(1800);
    expect(skinTierScore({ price: null, levelCount: 5, contentTierRank: null })).toBe(500);
  });

  it("rarityLabel matches rarityColor buckets", () => {
    expect(rarityLabel(2475)).toBe("ULTRA");
    expect(rarityLabel(1775)).toBe("PREMIUM");
    expect(rarityLabel(875)).toBe("SELECT");
    expect(rarityLabel(null)).toBe("STANDARD");
    expect(rarityLabel(null, 5)).toBe("PREMIUM");
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

  it("vpToUsd estimates dollars at the base tier (1000 VP = $9.99)", () => {
    expect(vpToUsd(0)).toBe(0);
    expect(vpToUsd(1000)).toBe(10);
    expect(vpToUsd(45230)).toBe(452);
  });
});

const agent = (over: Partial<AgentItem> = {}): AgentItem =>
  ({ id: "a1", name: "Jett", icon: null, role: "Duelist", roleIcon: null, price: null, equipped: false, ...over });

const profileWith = (topAgents: { id: string; name: string; games: number; wins: number }[]): ProfileStats => ({
  ranked: { act: null, career: null, winsByTier: [], leaderboardRank: null },
  matches: [],
  window: {
    games: topAgents.reduce((n, a) => n + a.games, 0),
    wins: 0, losses: 0, draws: 0, kd: null, hsPct: null, acs: null,
    topAgents: topAgents.map((a) => ({ ...a, icon: null, kills: 0, deaths: 0, assists: 0 })),
    topMap: null,
    form: [],
  },
  accountCreatedAt: null,
});

const agentPayload = (agents: AgentItem[], profile: ProfileStats | null) =>
  ({
    puuid: "p", gameName: "G", tagLine: "T", region: "na",
    accountLevel: 1, ranks: { current: null, peak: null }, wallet: { vp: null, rp: null },
    skins: [], cards: [], titles: [], buddies: [], agents, profile,
    pricesAvailable: true, generatedAt: "2026-10-10",
  }) as ShowcasePayload;

describe("buildSelection agent default", () => {
  it("checks the most-played owned agent", () => {
    const sel = buildSelection(
      agentPayload(
        [agent({ id: "sova", name: "Sova" }), agent({ id: "jett" })],
        profileWith([{ id: "jett", name: "Jett", games: 4, wins: 3 }])
      )
    );
    expect(sel["agent:jett"]).toBe(true);
    expect(sel["agent:sova"]).toBe(false);
  });

  it("checks nothing when there is no profile or the favorite is unowned", () => {
    const none = buildSelection(agentPayload([agent({ id: "jett" })], null));
    expect(none["agent:jett"]).toBe(false);
    const unowned = buildSelection(
      agentPayload([agent({ id: "sova", name: "Sova" })], profileWith([{ id: "jett", name: "Jett", games: 4, wins: 3 }]))
    );
    expect(Object.values(unowned).every((v) => !v)).toBe(true);
  });
});

describe("favoriteAgent", () => {
  it("resolves the top window agent against owned agents only", () => {
    expect(
      favoriteAgent(agentPayload([agent({ id: "sova", name: "Sova" })], profileWith([{ id: "jett", name: "Jett", games: 9, wins: 5 }])))
    ).toBeNull();
    expect(
      favoriteAgent(agentPayload([agent({ id: "jett", name: "Jett" })], profileWith([{ id: "jett", name: "Jett", games: 9, wins: 5 }])))?.name
    ).toBe("Jett");
  });

  it("no profile / no matches → null", () => {
    expect(favoriteAgent(agentPayload([agent()], null))).toBeNull();
    expect(favoriteAgent(agentPayload([agent()], profileWith([])))).toBeNull();
  });
});

describe("profile helpers", () => {
  it("winratePct rounds to whole percent and rejects empty records", () => {
    expect(winratePct(13, 20)).toBe(65);
    expect(winratePct(1, 3)).toBe(33);
    expect(winratePct(0, 0)).toBeNull();
    expect(winratePct(0, 7)).toBe(0);
  });

  it("relTime buckets into minutes/hours/days, then a date", () => {
    const now = Date.parse("2026-10-10T12:00:00Z");
    expect(relTime("2026-10-10T11:59:30Z", now)).toBe("just now");
    expect(relTime("2026-10-10T11:45:00Z", now)).toBe("15m ago");
    expect(relTime("2026-10-10T09:00:00Z", now)).toBe("3h ago");
    expect(relTime("2026-10-07T12:00:00Z", now)).toBe("3d ago");
    expect(relTime("2026-09-01T12:00:00Z", now)).toBe("Sep 1");
    expect(relTime("nonsense", now)).toBe("");
  });

  it("matchDuration formats mm:ss and hides missing data", () => {
    expect(matchDuration(1_920_000)).toBe("32:00");
    expect(matchDuration(95_000)).toBe("1:35");
    expect(matchDuration(null)).toBeNull();
    expect(matchDuration(0)).toBeNull();
  });
});
