import sharp from "sharp";

/**
 * Widths `/img/:url?w=` may request. A fixed set keeps the cache bounded and
 * stops callers from asking the server to render arbitrary sizes.
 */
export const THUMB_WIDTHS = [64, 128, 256] as const;
const CACHE_MAX_BYTES = 48 * 1024 * 1024;

/** Formats worth shrinking; SVG/GIF pass through untouched. */
const RESIZABLE = new Set(["image/png", "image/jpeg", "image/webp"]);

export function parseThumbWidth(raw: unknown): number | null {
  if (typeof raw !== "string" || !/^\d{1,4}$/.test(raw)) return null;
  const w = Number(raw);
  return (THUMB_WIDTHS as readonly number[]).includes(w) ? w : null;
}

export const canThumbnail = (contentType: string) => RESIZABLE.has(contentType);

/** Square-bounded WebP that keeps transparency; never upscales. */
export async function makeThumbnail(input: Buffer, width: number): Promise<Buffer> {
  return sharp(input, { limitInputPixels: 4096 * 4096 })
    .resize({ width, height: width, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 82, alphaQuality: 90, effort: 4 })
    .toBuffer();
}

/** Byte-bounded LRU (Map keeps insertion order; re-insert on hit). */
export class ThumbCache {
  private map = new Map<string, Buffer>();
  private bytes = 0;
  constructor(private maxBytes = CACHE_MAX_BYTES) {}

  get(key: string): Buffer | undefined {
    const hit = this.map.get(key);
    if (hit) {
      this.map.delete(key);
      this.map.set(key, hit);
    }
    return hit;
  }

  set(key: string, value: Buffer): void {
    if (value.byteLength > this.maxBytes) return;
    const old = this.map.get(key);
    if (old) {
      this.bytes -= old.byteLength;
      this.map.delete(key);
    }
    this.map.set(key, value);
    this.bytes += value.byteLength;
    for (const [k, v] of this.map) {
      if (this.bytes <= this.maxBytes) break;
      this.map.delete(k);
      this.bytes -= v.byteLength;
    }
  }

  get size(): number {
    return this.bytes;
  }
}
