import { describe, it, expect } from "vitest";
import { parseEntitlements, parseRanks, rankBadge, buildPriceMapFromStorefront } from "./valorant";

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
