/**
 * Proxied image resized server-side to a small WebP (`/img/:url?w=`). Use for
 * art drawn far below its source size; agent busts are 1024×1024 upstream and
 * player card portraits ~170 KB PNGs.
 * Widths must be one of the server's THUMB_WIDTHS (64, 128, 256).
 */
export const thumb = (u: string | null | undefined, w: 64 | 128 | 256): string | undefined =>
  u ? `/img/${encodeURIComponent(u)}?w=${w}` : undefined;
