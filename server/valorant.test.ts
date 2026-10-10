import { describe, it, expect } from "vitest";
import type { RecentMatch } from "../src/types";
import { parseEntitlements, parseRanks, parseRankedStats, rankBadge, buildPriceMapFromStorefront, buildStoreSection, tierVpPrice, projectRecentMatch, computeMatchWindow, fetchRecentMatches } from "./valorant";

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
      { skinId: "aaa", name: "Recon Vandal", weaponName: "Vandal", icon: "https://x/l4.png", price: 1775, discountPrice: null, discountPercent: null, owned: true, contentTierRank: null, contentTierIcon: null },
    ]);
    expect(out!.secondsToReset).toBe(3600);
    expect(out!.nightMarket).toEqual([]);
    expect(out!.accessories).toEqual([]);
  });

  it("parses night-market discounts and skips trials", () => {
    const sf = {
      BonusStore: {
        BonusStoreOffers: [
          {
            Offer: { Rewards: [{ ItemID: "ddd" }], Cost: { "85ad13f7-3d1b-5128-9eb2-7cd8ee0b5741": 2175 } },
            DiscountPercent: 50,
            DiscountCosts: { "85ad13f7-3d1b-5128-9eb2-7cd8ee0b5741": 1087 },
            IsSeen: false,
          },
          { IsTrial: true, Offer: { Rewards: [{ ItemID: "bbb" }], Cost: VP }, DiscountPercent: 40, DiscountCosts: VP },
        ],
      },
    };
    const out = buildStoreSection(sf, catalog, new Set());
    expect(out!.offers).toEqual([]);
    expect(out!.nightMarket).toEqual([
      { skinId: "ddd", name: "Night Gun", weaponName: "Vandal", icon: "https://x/night.png", price: 2175, discountPrice: 1087, discountPercent: 50, owned: false, contentTierRank: 3, contentTierIcon: "https://x/tier3.png" },
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

describe("tierVpPrice", () => {
  it("maps content-tier ranks to standard VP", () => {
    expect(tierVpPrice(0)).toBe(875);
    expect(tierVpPrice(1)).toBe(1275);
    expect(tierVpPrice(2)).toBe(1775);
    expect(tierVpPrice(3)).toBe(2175);
    expect(tierVpPrice(4)).toBe(2475);
  });

  it("null / unknown rank → null (battlepass or free skins)", () => {
    expect(tierVpPrice(null)).toBeNull();
    expect(tierVpPrice(99)).toBeNull();
  });
});

describe("parseRankedStats", () => {
  it("reads act record + RR, career totals, wins by tier and leaderboard rank", () => {
    const body = {
      QueueSkills: {
        competitive: {
          SeasonalInfoBySeasonID: {
            "act-1": { SeasonID: "act-1", NumberOfWins: 4, NumberOfGames: 9, CompetitiveTier: 15, RankedRating: 30 },
            "act-2": {
              SeasonID: "act-2", NumberOfWins: 22, NumberOfGames: 40, CompetitiveTier: 19,
              RankedRating: 64, LeaderboardRank: 8123, WinsByTier: { "18": 6, "19": 16, "3": 0 },
            },
          },
        },
      },
      LatestCompetitiveUpdate: { SeasonID: "act-2", TierAfterUpdate: 19, RankedRatingAfterUpdate: 71 },
    };
    const r = parseRankedStats(body);
    expect(r.act).toEqual({ wins: 22, games: 40, rr: 71 });
    expect(r.career).toEqual({ wins: 26, games: 49 });
    expect(r.winsByTier).toEqual([{ tier: 19, wins: 16 }, { tier: 18, wins: 6 }]);
    expect(r.leaderboardRank).toBe(8123);
  });

  it("matches the act by season key when the value has no SeasonID", () => {
    const body = {
      QueueSkills: { competitive: { SeasonalInfoBySeasonID: { "act-9": { NumberOfWins: 3, NumberOfGames: 7, RankedRating: 12 } } } },
      LatestCompetitiveUpdate: { SeasonID: "ACT-9", RankedRatingAfterUpdate: 12 },
    };
    expect(parseRankedStats(body).act).toEqual({ wins: 3, games: 7, rr: 12 });
  });

  it("handles missing data without throwing", () => {
    expect(parseRankedStats({})).toEqual({ act: null, career: null, winsByTier: [], leaderboardRank: null });
    expect(parseRankedStats(null).act).toBeNull();
    // Seasons without a match on LatestCompetitiveUpdate → act unknown, career still summed.
    const r = parseRankedStats({
      QueueSkills: { competitive: { SeasonalInfoBySeasonID: { x: { NumberOfWins: 1, NumberOfGames: 2 } } } },
    });
    expect(r.act).toBeNull();
    expect(r.career).toEqual({ wins: 1, games: 2 });
  });
});

describe("projectRecentMatch", () => {
  const MAP_URL = "/Game/Maps/Ascent/Ascent";
  const cat = () => ({
    maps: new Map([[MAP_URL.toLowerCase(), { name: "Ascent", icon: "map.png" }]]),
    gameModes: new Map([
      ["hurm", "Team Deathmatch"],
      ["bomb", "Standard"],
    ]),
    agents: new Map([["jett-uuid", { name: "Jett", icon: "jett.png", role: "Duelist", roleIcon: "duelist.png" }]]),
  });
  const detail = (infoOver: Record<string, unknown> = {}, topOver: Record<string, unknown> = {}) => ({
    matchInfo: {
      matchId: "m1",
      mapId: MAP_URL,
      gameStartMillis: 1760000000000,
      gameLengthMillis: 1_920_000,
      queueID: "competitive",
      gameMode: "/Game/GameModes/Bomb/BombGameMode.BombGameMode",
      isCompleted: true,
      ...infoOver,
    },
    players: [
      { subject: "PUUID", teamId: "Blue", characterId: "jett-uuid", stats: { score: 3120, roundsPlayed: 20, kills: 18, deaths: 12, assists: 6 } },
      { subject: "other", teamId: "Red", characterId: "sova-uuid", stats: { score: 2100, roundsPlayed: 20, kills: 10, deaths: 15, assists: 4 } },
    ],
    teams: [
      { teamId: "Blue", won: true, roundsWon: 13 },
      { teamId: "Red", won: false, roundsWon: 7 },
    ],
    ...topOver,
  });
  const ctx = (rr: [string, number][] = []) => ({ puuid: "puuid", rrByMatch: new Map(rr), ...cat() });

  it("projects self stats, W/L + score, agent and catalog labels", () => {
    const m = projectRecentMatch(detail(), ctx());
    expect(m).toMatchObject({
      id: "m1",
      start: new Date(1760000000000).toISOString(),
      queue: "competitive",
      mode: "COMPETITIVE",
      map: "Ascent",
      mapIcon: "map.png",
      agentId: "jett-uuid",
      agent: "Jett",
      agentIcon: "jett.png",
      won: true,
      score: { mine: 13, theirs: 7 },
      kills: 18, deaths: 12, assists: 6,
      acs: 156, // 3120 score / 20 rounds
      hsPct: null, // no roundResults in this fixture
      durationMs: 1_920_000,
      rr: null,
    });
  });

  it("mode falls back to the gamemode catalog, then the raw queue ID", () => {
    const tdm = projectRecentMatch(
      detail({ queueID: "hurm", gameMode: "/Game/GameModes/HURM/HURM.HURM" }),
      ctx()
    );
    expect(tdm?.mode).toBe("Team Deathmatch");
    const unknown = projectRecentMatch(
      detail({ queueID: "ootb", gameMode: "/Game/GameModes/Nope/Nope.Nope" }),
      ctx()
    );
    expect(unknown?.mode).toBe("OOTB");
  });

  it("attaches RR only for competitive/premier", () => {
    const rr = ctx([["m1", 18]]);
    expect(projectRecentMatch(detail(), rr)?.rr).toBe(18);
    const unrated = projectRecentMatch(detail({ queueID: "unrated" }), rr);
    expect(unrated?.rr).toBeNull();
  });

  it("pools headshots over the self player's round damage", () => {
    const rounds = [
      { playerStats: [{ subject: "PUUID", damage: [{ headshots: 6, bodyshots: 2, legshots: 0 }] }] },
      { playerStats: [
        { subject: "PUUID", damage: [{ headshots: 0, bodyshots: 10, legshots: 0 }] },
        { subject: "other", damage: [{ headshots: 9, bodyshots: 0, legshots: 0 }] },
      ] },
    ];
    expect(projectRecentMatch(detail({}, { roundResults: rounds }), ctx())?.hsPct).toBe(33);
    expect(projectRecentMatch(detail({}, { roundResults: [{ playerStats: [{ subject: "PUUID", damage: [] }] }] }), ctx())?.hsPct).toBeNull();
  });

  it("unknown map falls back to the raw last path segment", () => {
    const m = projectRecentMatch(detail({ mapId: "/Game/Maps/Foo/Foo_Bar" }), ctx());
    expect(m?.map).toBe("Foo_Bar");
    expect(m?.mapIcon).toBeNull();
  });

  it("returns null for incomplete, self-less, stat-less, or timeless matches", () => {
    expect(projectRecentMatch(detail({ isCompleted: false }), ctx())).toBeNull();
    expect(projectRecentMatch(detail({ gameStartMillis: 0 }), ctx())).toBeNull();
    expect(projectRecentMatch({ ...detail(), players: [] }, ctx())).toBeNull();
    expect(
      projectRecentMatch(
        {
          ...detail(),
          players: [{ subject: "PUUID", teamId: "Blue", characterId: "jett-uuid", stats: null }],
        },
        ctx()
      )
    ).toBeNull();
  });

  it("null teams → null result, no score", () => {
    const m = projectRecentMatch(detail({}, { teams: null }), ctx());
    expect(m?.won).toBeNull();
    expect(m?.score).toBeNull();
  });
});

describe("computeMatchWindow", () => {
  const row = (over: Partial<RecentMatch>): RecentMatch => ({
    id: "m", start: "2026-10-01T00:00:00.000Z", queue: "competitive", mode: "COMPETITIVE",
    map: "Ascent", mapIcon: null, agentId: "jett", agent: "Jett", agentIcon: null,
    won: true, score: { mine: 13, theirs: 5 }, kills: 10, deaths: 10, assists: 2,
    acs: 200, hsPct: 20, durationMs: 1000, rr: 10, ...over,
  });

  it("aggregates record, K/D, HS%, ACS, form and most-played agents/maps", () => {
    const w = computeMatchWindow([
      row({ id: "1", kills: 20, deaths: 10, hsPct: 30, acs: 300, rr: 15 }),
      row({ id: "2", won: false, kills: 10, deaths: 20, agent: "Sova", agentId: "sova", map: "Haven", hsPct: 20, acs: 200, rr: -12 }),
      row({ id: "3", won: true, agent: "Sova", agentId: "sova", map: "Haven", kills: 10, deaths: 10, hsPct: null, acs: 100 }),
      row({ id: "4", won: null, agent: "Jett", agentId: "jett", kills: 0, deaths: 0, hsPct: 40, acs: 0 }),
    ]);
    expect(w).toMatchObject({ games: 4, wins: 2, losses: 1, draws: 1, kd: 1, hsPct: 30, acs: 150 });
    expect(w?.form).toEqual(["W", "L", "W", "D"]);
    expect(w?.topAgents.map((a) => [a.name, a.games, a.wins])).toEqual([["Jett", 2, 1], ["Sova", 2, 1]]);
    expect(w?.topMap).toEqual({ name: "Ascent", icon: null, games: 2, wins: 1 });
  });

  it("empty window → null; zero deaths falls back to kills", () => {
    expect(computeMatchWindow([])).toBeNull();
    const w = computeMatchWindow([row({ deaths: 0, kills: 7 })]);
    expect(w?.kd).toBe(7);
  });
});

describe("fetchRecentMatches", () => {
  const cat = () => ({
    maps: new Map([["/game/maps/ascent/ascent", { name: "Ascent", icon: null }]]),
    gameModes: new Map([["bomb", "Standard"]]),
    agents: new Map([["jett-uuid", { name: "Jett", icon: null, role: null, roleIcon: null }]]),
  });
  const detail = (id: string, queueID: string) => ({
    matchInfo: {
      matchId: id, mapId: "/Game/Maps/Ascent/Ascent", gameStartMillis: 1760000000000,
      gameLengthMillis: 1000, queueID, gameMode: "/Game/GameModes/Bomb/BombGameMode.BombGameMode",
      isCompleted: true,
    },
    players: [{ subject: "PUUID", teamId: "Blue", characterId: "jett-uuid", stats: { score: 100, roundsPlayed: 10, kills: 1, deaths: 1, assists: 1 } }],
    teams: [{ teamId: "Blue", won: true, roundsWon: 13 }, { teamId: "Red", won: false, roundsWon: 9 }],
  });

  it("history + MMR + ≤10 detail calls, RR joined, order kept, failures skipped", async () => {
    const ids = Array.from({ length: 12 }, (_, i) => `m${i + 1}`);
    const calls: string[] = [];
    const pdGet = async (p: string) => {
      calls.push(p);
      if (p.startsWith("/match-history/")) return { History: ids.map((MatchID) => ({ MatchID, QueueID: "competitive" })) };
      if (p.startsWith("/mmr/")) return { Matches: [{ MatchID: "m1", RankedRatingEarned: 12 }, { MatchID: "m2", RankedRatingEarned: -7 }] };
      if (p.includes("/match-details/")) {
        const id = p.split("/").pop()!;
        if (id === "m3") return null; // one failed detail
        return detail(id, id === "m2" ? "unrated" : "competitive");
      }
      return null;
    };
    const out = await fetchRecentMatches(pdGet, "puuid", cat());
    expect(calls.some((c) => c.startsWith("/match-history/") && c.includes("endIndex=15"))).toBe(true);
    expect(calls.filter((c) => c.includes("/match-details/"))).toHaveLength(10);
    expect(out.map((m) => m.id)).toEqual(["m1", "m2", "m4", "m5", "m6", "m7", "m8", "m9", "m10"]);
    expect(out[0].rr).toBe(12);
    // m2 is unrated — the joined -7 must not leak outside ranked queues.
    expect(out[1].rr).toBeNull();
    expect(out[1].mode).toBe("UNRATED");
  });

  it("upstream failures → []", async () => {
    const out = await fetchRecentMatches(async () => null, "puuid", cat());
    expect(out).toEqual([]);
  });
});
