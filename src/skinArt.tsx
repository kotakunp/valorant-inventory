import type { CSSProperties, ImgHTMLAttributes } from "react";
import { gunLabel } from "./logic";

/**
 * The one skin-art sizing contract shared by every surface that renders gun
 * skins: showcase stacks and empty slots, the sidebar skin grid, the hover
 * spread, and the store strip cards + peek.
 *
 * Riot's skin displayIcons are all normalized to one bitmap width and cropped
 * tight to the gun, so fitting them to a box naively draws a small pistol as
 * large as a long rifle (and each surface used to fit them differently). The
 * renders do preserve true shape, so sizing each render by the weapon's true
 * body length restores real relative size: `img.skin-art` (styles.css) draws
 * at `--gun-len` of its fit box width, height follows the render's own aspect,
 * and the box height cap only guards overflow. The same `--gun-len` on every
 * surface means one regulated relative size everywhere.
 *
 * The lengths below are true relative weapon lengths (longest = 1) measured
 * off Riot's official weapon renders at their shared pixel scale — content
 * widths 161px (Frenzy) … 503px (Phantom/Guardian/Marshal). A small gun can
 * never render larger than a long one, on any surface. MELEE is set to the
 * share that fits the 68px melee strip at full art height without the height
 * cap letterboxing it, since knives span no fixed length.
 */

/** True relative body length per weapon, longest gun = 1. */
export const GUN_LENGTH: Record<string, number> = {
  FRENZY: 0.32,
  CLASSIC: 0.36,
  BANDIT: 0.45,
  SHERIFF: 0.48,
  GHOST: 0.58,
  MELEE: 0.5,
  SHORTY: 0.6,
  STINGER: 0.65,
  SPECTRE: 0.69,
  BULLDOG: 0.78,
  BUCKY: 0.99,
  JUDGE: 0.8,
  VANDAL: 0.82,
  ODIN: 0.87,
  ARES: 0.95,
  OUTLAW: 0.99,
  OPERATOR: 0.99,
  MARSHAL: 1,
  GUARDIAN: 1,
  WARDEN: 1,
  PHANTOM: 1,
};

/** Length for weapons the table does not know (new guns, odd catalog names). */
export const DEFAULT_GUN_LENGTH = 0.78;

/**
 * Canonical body length for a weapon's skin art. Weapon-name normalization is
 * shared with the loadout (`gunLabel`); any knife/melee name resolves to the
 * MELEE entry and unknown guns fall back to DEFAULT_GUN_LENGTH.
 */
export function gunLength(weaponName: string | null | undefined, isKnife = false): number {
  const name = weaponName ?? "";
  const id = /knife|melee/i.test(name) ? "MELEE" : gunLabel({ weaponName: name, isKnife });
  return GUN_LENGTH[id] ?? DEFAULT_GUN_LENGTH;
}

/** Inline `--gun-len` for an `img.skin-art`, so CSS does the per-surface fit. */
export function skinArtStyle(weaponName: string | null | undefined, isKnife = false): CSSProperties {
  return { ["--gun-len" as string]: String(gunLength(weaponName, isKnife)) } as CSSProperties;
}

type SkinArtProps = ImgHTMLAttributes<HTMLImageElement> & {
  /** Weapon the art belongs to — drives the regulated size. */
  weaponName?: string | null;
  isKnife?: boolean;
};

/** Gun-skin art img at the regulated size (src/skinArt.ts contract). */
export function SkinArt({ weaponName, isKnife = false, className, style, ...rest }: SkinArtProps) {
  return (
    <img
      {...rest}
      className={className ? `skin-art ${className}` : "skin-art"}
      style={{ ...skinArtStyle(weaponName, isKnife), ...style }}
    />
  );
}
