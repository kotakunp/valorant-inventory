import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Catalog } from "./catalog";
import type { ShowcasePayload } from "../src/types";
import {
  ManifestError,
  manifestFromPayload,
  setShareSecretForTests,
  signManifest,
  verifyManifest,
  withShareProof,
} from "./shareManifest";
import {
  buildSnapshot,
  injectShareMeta,
  MemoryShareStore,
  newShareId,
  parsePicks,
  parsePreview,
  SHARE_ID_RE,
  SHARE_TTL_MS,
  ShareError,
} from "./share";

const skinEntry = (uuid: string, weaponName: string, chromas: string[]) => ({
  weaponUuid: "w-" + weaponName,
  weaponName,
  category: "EEquippableCategory::Rifle",
  defaultSkinUuid: null,
  skin: {
    uuid,
    displayName: `${weaponName} Skin ${uuid}`,
    contentTierUuid: "tier-premium",
    levels: [{ uuid: uuid + "-l1", displayIcon: `https://media.valorant-api.com/${uuid}.png` }],
    chromas: chromas.map((c, i) => ({ uuid: c, displayName: i === 0 ? "Base" : `Variant ${i + 1}`, displayIcon: `https://media.valorant-api.com/${c}.png` })),
  },
});

function catalog(): Catalog {
  const skins = new Map<string, any>([
    ["s1", skinEntry("s1", "Vandal", ["c1a", "c1b"])],
    ["s2", skinEntry("s2", "Phantom", ["c2a"])],
    ["s3", skinEntry("s3", "Classic", ["c3a"])],
  ]);
  return {
    skins,
    cards: new Map([["card1", { name: "Card One", icon: "https://media.valorant-api.com/card1.png", avatar: null }]]),
    titles: new Map([["title1", { name: "Title One", text: "Potato" }]]),
    buddies: new Map([["bud1", { name: "Buddy", icon: "https://media.valorant-api.com/bud1.png" }]]),
    sprays: new Map(),
    rankTiers: new Map([[24, { name: "IMMORTAL 1", icon: null, color: "#bb3d65" }]]),
    contentTiers: new Map([["tier-premium", { rank: 2, icon: null }]]),
    weaponIcons: new Map([["VANDAL", "https://media.valorant-api.com/vandal.png"]]),
  } as Catalog;
}

function payload(): ShowcasePayload {
  return {
    puuid: "secret-puuid",
    gameName: "Kotakun",
    tagLine: "0001",
    region: "ap",
    accountLevel: 187,
    ranks: { current: 24, peak: 24 },
    wallet: { vp: 1240, rp: 60 },
    skins: [
      { id: "s1", name: "x", weaponName: "Vandal", icon: null, price: 1775, levelCount: 1, variantCount: 2, isKnife: false, equipped: true, chromas: [], defaultChromaId: "c1b" },
      { id: "s2", name: "y", weaponName: "Phantom", icon: null, price: 1275, levelCount: 1, variantCount: 1, isKnife: false, equipped: false, chromas: [], defaultChromaId: null },
    ],
    cards: [{ id: "card1", name: "Card One", icon: null, price: 375, equipped: true }],
    titles: [{ id: "title1", name: "Title One", text: "Potato", price: null, equipped: true }],
    buddies: [{ id: "bud1", name: "Buddy", icon: null, price: 475, equipped: false }],
    pricesAvailable: true,
    store: { offers: [], secondsToReset: 1, nightMarket: [], accessories: [] },
    generatedAt: "2026-10-10T00:00:00.000Z",
  };
}

const picksAll = { skins: [{ id: "s1", chroma: null }, { id: "s2", chroma: null }], front: { PHANTOM: "s2" }, card: "card1", title: "title1", buddies: ["bud1"] };

beforeEach(() => setShareSecretForTests("test-secret-test-secret"));
afterEach(() => setShareSecretForTests(null));

describe("share manifest", () => {
  it("round-trips without the PUUID", () => {
    const token = signManifest(manifestFromPayload(payload()));
    const m = verifyManifest(token);
    expect(m.gameName).toBe("Kotakun");
    expect(m.skins.map((s) => s[0])).toEqual(["s1", "s2"]);
    expect(JSON.stringify(m)).not.toContain("secret-puuid");
  });

  it("rejects a tampered body or signature", () => {
    const token = signManifest(manifestFromPayload(payload()));
    const [body, sig] = token.split(".");
    expect(() => verifyManifest(`${body}x.${sig}`)).toThrow(ManifestError);
    expect(() => verifyManifest(`${body}.${sig.slice(0, -2)}AA`)).toThrow(ManifestError);
    expect(() => verifyManifest("garbage")).toThrow(ManifestError);
    expect(() => verifyManifest(undefined)).toThrow(ManifestError);
  });

  it("rejects proofs signed with another secret", () => {
    const token = signManifest(manifestFromPayload(payload()));
    setShareSecretForTests("another-secret-another");
    expect(() => verifyManifest(token)).toThrow(ManifestError);
  });

  it("expires", () => {
    const token = signManifest(manifestFromPayload(payload(), 0));
    expect(() => verifyManifest(token, 25 * 60 * 60 * 1000)).toThrow(/expired/);
  });

  it("is attached to payloads", () => {
    const p = withShareProof(payload());
    expect(verifyManifest(p.shareProof).tagLine).toBe("0001");
  });
});

describe("share snapshot", () => {
  const m = () => manifestFromPayload(payload());

  it("keeps only picked, owned items and resolves them from the catalog", () => {
    const snap = buildSnapshot(m(), parsePicks({ ...picksAll, skins: [{ id: "S1", chroma: "c1a" }] }), catalog(), new Date(0));
    const p = snap.showcase;
    expect(p.skins.map((s) => s.id)).toEqual(["s1"]);
    expect(p.skins[0].name).toBe("Vandal Skin s1");
    expect(p.skins[0].price).toBe(1775);
    expect(p.skins[0].equipped).toBe(true);
    expect(snap.chromaSel).toEqual({ s1: "c1a" });
    expect(p.skins[0].icon).toContain("c1a");
    expect(snap.bringToFront).toEqual({});
    expect(p.puuid).toBe("");
    expect(p.store).toBeNull();
    expect(p.ranks.currentBadge?.name).toBe("IMMORTAL 1");
    expect(p.wallet).toEqual({ vp: 1240, rp: 60 });
    expect(Date.parse(snap.expiresAt)).toBe(SHARE_TTL_MS);
  });

  it("falls back to the equipped chroma when the pick is not a variant of the skin", () => {
    const snap = buildSnapshot(m(), parsePicks({ ...picksAll, skins: [{ id: "s1", chroma: "c2a" }] }), catalog());
    expect(snap.chromaSel.s1).toBe("c1b");
  });

  it("keeps stack order only for shared skins", () => {
    const snap = buildSnapshot(m(), parsePicks(picksAll), catalog());
    expect(snap.bringToFront).toEqual({ PHANTOM: "s2" });
    expect(snap.showcase.cards[0].id).toBe("card1");
    expect(snap.showcase.titles[0].text).toBe("Potato");
    expect(snap.showcase.buddies[0].price).toBe(475);
  });

  it("refuses items the account does not own", () => {
    expect(() => buildSnapshot(m(), parsePicks({ ...picksAll, skins: [{ id: "s3", chroma: null }] }), catalog())).toThrow(ShareError);
    expect(() => buildSnapshot(m(), parsePicks({ ...picksAll, card: "card2" }), catalog())).toThrow(ShareError);
    expect(() => buildSnapshot(m(), parsePicks({ ...picksAll, buddies: ["bud2"] }), catalog())).toThrow(ShareError);
  });

  it("validates pick shape", () => {
    expect(() => parsePicks(null)).toThrow(ShareError);
    expect(() => parsePicks({ skins: [{ id: 5 }] })).toThrow(ShareError);
    expect(() => parsePicks({ skins: Array.from({ length: 601 }, () => ({ id: "s1" })) })).toThrow(/Too many/);
    expect(parsePicks({}).skins).toEqual([]);
  });
});

describe("share ids, previews and meta", () => {
  it("generates unambiguous 8-char ids", () => {
    const ids = new Set(Array.from({ length: 500 }, newShareId));
    expect(ids.size).toBe(500);
    for (const id of ids) expect(id).toMatch(SHARE_ID_RE);
    expect(SHARE_ID_RE.test("abcd1234")).toBe(false);
  });

  it("accepts small JPEG data URLs only", () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
    expect(parsePreview(`data:image/jpeg;base64,${jpeg.toString("base64")}`)?.equals(jpeg)).toBe(true);
    expect(parsePreview(null)).toBeNull();
    expect(() => parsePreview(`data:image/png;base64,${jpeg.toString("base64")}`)).toThrow(ShareError);
    expect(() => parsePreview(`data:image/jpeg;base64,${Buffer.from("hello").toString("base64")}`)).toThrow(ShareError);
    const big = Buffer.alloc(600 * 1024, 0);
    big.set([0xff, 0xd8, 0xff]);
    expect(() => parsePreview(`data:image/jpeg;base64,${big.toString("base64")}`)).toThrow(/too large/);
  });

  it("injects escaped Open Graph tags", () => {
    const snap = buildSnapshot(manifestFromPayload({ ...payload(), gameName: `<b>"x"` }), parsePicks(picksAll), catalog());
    const html = injectShareMeta(
      `<head><meta name="description" content="old" /><title>Old</title></head>`,
      snap,
      "https://valorant.muur.app",
      "Abcdefgh",
      true
    );
    expect(html).toContain("<title>&lt;b&gt;&quot;x&quot;#0001 · VALORANT collection</title>");
    expect(html).toContain('content="2 skins · 3,900 VP. Hover any weapon to see every skin."');
    expect(html).toContain('property="og:image" content="https://valorant.muur.app/s/Abcdefgh/preview.jpg"');
    expect(html).not.toContain("<b>");
  });
});

describe("memory store", () => {
  it("hides and purges expired shares", async () => {
    let now = 0;
    const store = new MemoryShareStore(() => now);
    const snap = buildSnapshot(manifestFromPayload(payload()), parsePicks(picksAll), catalog(), new Date(0));
    await store.create("Abcdefgh", snap, null);
    expect(await store.get("Abcdefgh")).not.toBeNull();
    now = SHARE_TTL_MS + 1;
    expect(await store.get("Abcdefgh")).toBeNull();
    expect(await store.purgeExpired()).toBe(1);
  });
});
