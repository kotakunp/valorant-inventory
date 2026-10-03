import { describe, it, expect } from "vitest";
import { GUN_LENGTH, DEFAULT_GUN_LENGTH, gunLength, skinArtStyle } from "./skinArt";

describe("gunLength", () => {
  it("resolves every official loadout gun", () => {
    for (const gun of [
      "Classic", "Shorty", "Frenzy", "Ghost", "Bandit", "Sheriff",
      "Stinger", "Spectre", "Bucky", "Judge", "Bulldog", "Guardian",
      "Phantom", "Vandal", "Marshal", "Outlaw", "Operator", "Ares", "Odin",
    ]) {
      expect(gunLength(gun), gun).toBe(GUN_LENGTH[gun.toUpperCase()]);
    }
  });

  it("is case- and alias-insensitive", () => {
    expect(gunLength("vandal")).toBe(gunLength("VANDAL"));
    expect(gunLength("Vandal Skin Name")).toBe(gunLength("Vandal"));
  });

  it("maps any knife/melee name to the melee length", () => {
    const melee = GUN_LENGTH.MELEE;
    expect(gunLength("Melee")).toBe(melee);
    expect(gunLength("Butterfly Knife", true)).toBe(melee);
    expect(gunLength("Tactical Knife")).toBe(melee);
  });

  it("falls back for unknown weapons and empty names", () => {
    expect(gunLength("Space Blaster")).toBe(DEFAULT_GUN_LENGTH);
    expect(gunLength(null)).toBe(DEFAULT_GUN_LENGTH);
    expect(gunLength(undefined)).toBe(DEFAULT_GUN_LENGTH);
    expect(gunLength("")).toBe(DEFAULT_GUN_LENGTH);
  });

  it("never sizes a small gun larger than a long one", () => {
    // The reported bug: pistol skins rendered oversized because their gun
    // model is small. Sidearms must stay below long guns on every surface.
    for (const pistol of ["Frenzy", "Classic", "Bandit", "Sheriff", "Ghost", "Shorty"]) {
      for (const longGun of ["Phantom", "Guardian", "Marshal", "Outlaw", "Operator", "Bucky", "Ares"]) {
        expect(gunLength(pistol), `${pistol} vs ${longGun}`).toBeLessThan(gunLength(longGun));
      }
    }
  });

  it("keeps all lengths inside 0..1 with known guns below the cap", () => {
    for (const [name, len] of Object.entries(GUN_LENGTH)) {
      expect(len, name).toBeGreaterThan(0);
      expect(len, name).toBeLessThanOrEqual(1);
    }
  });
});

describe("skinArtStyle", () => {
  it("sets --gun-len to the resolved length", () => {
    expect(skinArtStyle("Classic")).toEqual({ "--gun-len": String(GUN_LENGTH.CLASSIC) });
    expect(skinArtStyle("Melee")).toEqual({ "--gun-len": String(GUN_LENGTH.MELEE) });
    expect(skinArtStyle(null)).toEqual({ "--gun-len": String(DEFAULT_GUN_LENGTH) });
  });
});
