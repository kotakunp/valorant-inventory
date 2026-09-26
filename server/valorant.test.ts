import { describe, it, expect } from "vitest";
import { parseEntitlements, parseRanks, rankBadge, buildPriceMapFromStorefront, buildStoreSection } from "./valorant";

const CARDS = "3f296c07-64c3-494c-923b-fe692a4fa1bd";

describe("parseEntitlements", () => {
  it("reads flat per-type response (current Riot shape)", () => {
    const body = {
      ItemTypeID: CARDS,
      Entitlements: [{ ItemID: "a" }, { ItemID: "b" }, { junk: 1 }],
    };
    expect(parseEntitlements(body, CARDS)).toEqual(["a", "b"]);
  });

  it("ignores flat response for a different type", () => {
    const body = { ItemTypeID: "other", Entitlements: [{ ItemID: "a" }] };
    expect(parseEntitlements(body, CARDS)).toEqual([]);
  });

  it("still reads legacy EntitlementsByTypes shape", () => {
    const body = {
      EntitlementsByTypes: [
        { ItemTypeID: "zzz", Entitlements: [{ ItemID: "x" }] },
        { ItemTypeID: CARDS.toUpperCase(), Entitlements: [{ ItemID: "c1" }, { ItemID: "c2" }] },
      ],
    };
    expect(parseEntitlements(body, CARDS)).toEqual(["c1", "c2"]);
  });

  it("lowercases ItemIDs so catalog joins are case-insensitive", () => {
    const body = {
      ItemTypeID: CARDS,
      Entitlements: [{ ItemID: "AAAA-BBBB" }, { itemId: "CCCC" }],
    };
    expect(parseEntitlements(body, CARDS)).toEqual(["aaaa-bbbb", "cccc"]);
  });

  it("returns [] for garbage", () => {
    expect(parseEntitlements(null, CARDS)).toEqual([]);
    expect(parseEntitlements({}, CARDS)).toEqual([]);
  });
});

describe("buildPriceMapFromStorefront", () => {
  const VP = "85ad13f7-3d1b-5128-9eb2-7cd8ee0b5741";
  const KC = "85ca954a-41f2-ce94-9b45-8ca3dd39a00d";

  it("collects VP prices from daily, bundles, and night market", () => {
    const sf = {
      SkinsPanelLayout: {
        SingleItemStoreOffers: [
          { Cost: { [VP]: 1775 }, Rewards: [{ ItemID: "skin1" }] },
        ],
      },
      FeaturedBundle: {
        Bundle: {
          Items: [{ Item: { ItemID: "bundled" }, BasePrice: 8700, CurrencyID: VP }],
        },
        Bundles: [
          { Items: [], ItemOffers: [{ Offer: { Cost: { [VP]: 4350 }, Rewards: [{ ItemID: "part" }] } }] },
        ],
      },
      BonusStore: {
        BonusStoreOffers: [
          { Offer: { Cost: { [VP]: 1295 }, DiscountCosts: { [VP]: 800 }, Rewards: [{ ItemID: "night" }] } },
        ],
      },
      AccessoryStore: {
        AccessoryStoreOffers: [
          { Offer: { Cost: { [KC]: 4500 }, Rewards: [{ ItemID: "card-acc" }] } },
        ],
      },
    };
    const m = buildPriceMapFromStorefront(sf);
    expect(m.get("skin1")).toBe(1775);
    expect(m.get("bundled")).toBe(8700);
    expect(m.get("part")).toBe(4350);
    expect(m.get("night")).toBe(1295); // standard price, not discount
    expect(m.has("card-acc")).toBe(false); // KC not mixed into VP prices
  });

  it("handles null/garbage storefront", () => {
    expect(buildPriceMapFromStorefront(null).size).toBe(0);
    expect(buildPriceMapFromStorefront({}).size).toBe(0);
  });
});

describe("parseRanks", () => {
  it("current from latest update, peak as max season tier", () => {
    const body = {
      QueueSkills: { competitive: { SeasonalInfoBySeasonID: {
        s1: { CompetitiveTier: 15 }, s2: { CompetitiveTier: 22 }, s3: { CompetitiveTier: 18 },
      } } },
      LatestCompetitiveUpdate: { TierAfterUpdate: 19 },
    };
    expect(parseRanks(body)).toEqual({ current: 19, peak: 22 });
  });
  it("handles missing data", () => {
    expect(parseRanks({})).toEqual({ current: null, peak: null });
  });
});

describe("rankBadge", () => {
  const tiers = new Map<number, { name: string; icon: string | null; color: string }>([
    [24, { name: "IMMORTAL 1", icon: "https://media.valorant-api.com/x/24/largeicon.png", color: "#ff5c73" }],
    [27, { name: "RADIANT", icon: "https://media.valorant-api.com/x/27/largeicon.png", color: "#fff3c4" }],
  ]);
  it("returns official badge for a known tier", () => {
    expect(rankBadge(24, tiers)).toEqual({
      tier: 24,
      name: "IMMORTAL 1",
      icon: "https://media.valorant-api.com/x/24/largeicon.png",
      color: "#ff5c73",
    });
  });
  it("null tier or unknown tier → null", () => {
    expect(rankBadge(null, tiers)).toBeNull();
    expect(rankBadge(99, tiers)).toBeNull();
  });
});

describe("buildStoreSection", () => {
  const VP = { "85ad13f7-3d1b-5128-9eb2-7cd8ee0b5741": 1775 };
  const entry = (name: string, icon: string | null, levels: any[] = [], tier: string | null = null) => ({
    weaponUuid: "w",
    weaponName: "Vandal",
    category: "",
    defaultSkinUuid: null,
    skin: { displayName: name, displayIcon: icon, levels, contentTierUuid: tier },
  });
  const catalog = {
    skins: new Map<string, any>([
      ["aaa", entry("Recon Vandal", null, [{ displayIcon: "https://x/l4.png" }])],
      ["bbb", entry("Prime Vandal", "https://x/prime.png")],
      ["ddd", entry("Night Gun", "https://x/night.png", [], "TIERX")],
    ]),
    contentTiers: new Map<string, { rank: number; icon: string | null }>([["tierx", { rank: 3, icon: "https://x/tier3.png" }]]),
    buddies: new Map<string, { name: string; icon: string | null }>([
      ["bud1", { name: "Lil' Buddy", icon: "https://x/buddy.png" }],
    ]),
    cards: new Map<string, { name: string; icon: string | null; avatar: string | null }>(),
    titles: new Map<string, { name: string; text: string }>([
      ["ttl1", { name: "Ascendant", text: "Ascendant" }],
    ]),
    sprays: new Map<string, { name: string; icon: string | null }>([
      ["spr1", { name: "GG Spray", icon: "https://x/spray.png" }],
    ]),
  };

  it("parses daily offers + countdown; skips catalog misses", () => {
    const sf = {
      SkinsPanelLayout: {
        SingleItemStoreOffers: [
          { Rewards: [{ ItemID: "AAA" }], Cost: VP },
          { Rewards: [{ ItemID: "MISSING" }], Cost: VP },
        ],
        SingleItemOffersRemainingDurationInSeconds: 3600,
      },
    };
    const out = buildStoreSection(sf, catalog, new Set(["aaa"]));
    expect(out).not.toBeNull();
    expect(out!.offers).toEqual([
      { skinId: "aaa", name: "Recon Vandal", icon: "https://x/l4.png", price: 1775, discountPrice: null, owned: true, contentTierRank: null, contentTierIcon: null },
    ]);
    expect(out!.secondsToReset).toBe(3600);
    expect(out!.nightMarket).toEqual([]);
    expect(out!.accessories).toEqual([]);
  });

  it("parses night-market discounts and skips trials", () => {
    const sf = {
      BonusStore: {
        BonusStoreOffers: [
          { Offer: { Rewards: [{ ItemID: "ddd" }], Cost: { ...VP, ...{ "85ad13f7-3d1b-5128-9eb2-7cd8ee0b5741": 2175 } } }, DiscountPrice: 1087 },
          { IsTrial: true, Offer: { Rewards: [{ ItemID: "bbb" }], Cost: VP } },
        ],
      },
    };
    const out = buildStoreSection(sf, catalog, new Set());
    expect(out!.offers).toEqual([]);
    expect(out!.nightMarket).toEqual([
      { skinId: "ddd", name: "Night Gun", icon: "https://x/night.png", price: 2175, discountPrice: 1087, owned: false, contentTierRank: 3, contentTierIcon: "https://x/tier3.png" },
    ]);
    expect(out!.secondsToReset).toBeNull();
  });

  it("null when storefront missing", () => {
    expect(buildStoreSection(null, catalog, new Set())).toBeNull();
  });

  it("parses accessory-store offers with KC prices, skips unknown items", () => {
    const KC = { "85ca954a-41f2-ce94-9b45-8ca3dd39a00d": 4000 };
    const sf = {
      AccessoryStore: {
        AccessoryStoreOffers: [
          { Offer: { Rewards: [{ ItemTypeID: "dd3bf334-87f3-40bd-b043-682a57a8dc3a", ItemID: "BUD1" }], Cost: KC } },
          { Offer: { Rewards: [{ ItemTypeID: "037ad50e-51ea-4535-8846-7076d7fe297a", ItemID: "SPR1" }], Cost: KC } },
          { Offer: { Rewards: [{ ItemTypeID: "de7caa6b-adf7-4588-bbd1-143831e786c6", ItemID: "TTL1" }], Cost: KC } },
          { Offer: { Rewards: [{ ItemTypeID: "3f296c07-64c3-494c-923b-fe692a4fa1bd", ItemID: "NOPE" }], Cost: KC } },
        ],
      },
    };
    const out = buildStoreSection(sf, catalog, new Set());
    expect(out!.accessories).toEqual([
      { id: "bud1", name: "Lil' Buddy", icon: "https://x/buddy.png", kind: "buddy", price: 4000 },
      { id: "spr1", name: "GG Spray", icon: "https://x/spray.png", kind: "spray", price: 4000 },
      { id: "ttl1", name: "Ascendant", icon: null, kind: "title", price: 4000 },
    ]);
    expect(out!.offers).toEqual([]);
    expect(out!.nightMarket).toEqual([]);
  });
});
