import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { makeThumbnail, parseThumbWidth, ThumbCache } from "./thumbnail";

describe("parseThumbWidth", () => {
  it("accepts only the fixed widths", () => {
    expect(parseThumbWidth("128")).toBe(128);
    expect(parseThumbWidth("64")).toBe(64);
    expect(parseThumbWidth("100")).toBeNull();
    expect(parseThumbWidth("128px")).toBeNull();
    expect(parseThumbWidth(["128"])).toBeNull();
    expect(parseThumbWidth(undefined)).toBeNull();
  });
});

describe("makeThumbnail", () => {
  it("shrinks a large transparent PNG to a small WebP that keeps alpha", async () => {
    const png = await sharp({ create: { width: 1024, height: 1024, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 0.5 } } })
      .png()
      .toBuffer();
    const out = await makeThumbnail(png, 128);
    const meta = await sharp(out).metadata();
    expect(meta.format).toBe("webp");
    expect(meta.width).toBe(128);
    expect(meta.height).toBe(128);
    expect(meta.hasAlpha).toBe(true);
  });

  it("never upscales", async () => {
    const png = await sharp({ create: { width: 40, height: 20, channels: 4, background: "#fff" } }).png().toBuffer();
    const meta = await sharp(await makeThumbnail(png, 256)).metadata();
    expect([meta.width, meta.height]).toEqual([40, 20]);
  });
});

describe("ThumbCache", () => {
  it("evicts least-recently used entries past the byte budget", () => {
    const cache = new ThumbCache(10);
    cache.set("a", Buffer.alloc(4));
    cache.set("b", Buffer.alloc(4));
    cache.get("a");
    cache.set("c", Buffer.alloc(4));
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toBeDefined();
    expect(cache.get("c")).toBeDefined();
    expect(cache.size).toBe(8);
    cache.set("huge", Buffer.alloc(11));
    expect(cache.get("huge")).toBeUndefined();
  });
});
