import { createPortal } from "react-dom";
import type { CSSProperties } from "react";
import type { ChromaSelection, SkinItem } from "./types";
import { rarityColor } from "./logic";

interface Props {
  gun: string;
  items: SkinItem[];
  rect: DOMRect;
  chromas: ChromaSelection;
  onEnter: () => void;
  onLeave: () => void;
  onFront?: (gun: string, id: string) => void;
  onRemove?: (id: string) => void;
  onChroma?: (skin: string, chroma: string) => void;
}

const image = (url: string) => `/img/${encodeURIComponent(url)}`;

/** Unscaled hover spread: each skin has its own fixed, generous pointer target. */
export function HoverSkins({ gun, items, rect, chromas, onEnter, onLeave, onFront, onRemove, onChroma }: Props) {
  if (!items.length) return null;
  const width = Math.min(360, window.innerWidth - 24);
  const height = Math.min(48 + items.length * 132, window.innerHeight * 0.75);
  const left = rect.right + width + 12 < window.innerWidth
    ? rect.right + 8
    : Math.max(12, rect.left - width - 8);
  const top = Math.max(12, Math.min(rect.top, window.innerHeight - height - 12));

  return createPortal(
    <section className="skin-hover-spread" aria-label={`${gun} skins`}
      style={{ left, top, width, maxHeight: height }}
      onPointerEnter={onEnter} onPointerLeave={onLeave}
      onFocus={onEnter} onBlur={event => {
        if (!event.currentTarget.contains(event.relatedTarget)) onLeave();
      }}>
      <header><strong>{gun}</strong><span>{items.length} {items.length === 1 ? "skin" : "skins"}</span></header>
      <div className="skin-hover-list">
        {items.map((skin, index) => {
          const active = skin.chromas.find(c => c.id === (chromas[skin.id] ?? skin.defaultChromaId)) ?? skin.chromas[0];
          const icon = active?.icon ?? skin.icon;
          return (
            <article key={skin.id} className="skin-hover-row" tabIndex={0}
              aria-label={skin.name}
              style={{ "--rarity": rarityColor(skin.price, skin.levelCount, skin.contentTierRank) } as CSSProperties}>
              <div className="skin-hover-name"><strong>{skin.name}</strong><span>{index === 0 && gun !== "MELEE" ? "FRONT" : skin.equipped ? "EQUIPPED" : ""}</span></div>
              <div className="skin-hover-art">{icon && <img src={image(icon)} alt={skin.name} />}</div>
              <div className="skin-hover-actions">
                <div className="skin-hover-variants" role="group" aria-label={`${skin.name} variants`}>
                  {skin.chromas.length > 1 && skin.chromas.map((chroma, i) => (
                    <button key={chroma.id} aria-label={chroma.name} title={chroma.name}
                      aria-pressed={active?.id === chroma.id} onClick={() => onChroma?.(skin.id, chroma.id)}>
                      {chroma.icon ? <img src={image(chroma.icon)} alt="" /> : i + 1}
                    </button>
                  ))}
                </div>
                {gun !== "MELEE" && <button disabled={index === 0} onClick={() => onFront?.(gun, skin.id)}>To front</button>}
                <button onClick={() => onRemove?.(skin.id)} aria-label={`Remove ${skin.name}`}>Remove</button>
              </div>
            </article>
          );
        })}
      </div>
    </section>,
    document.fullscreenElement ?? document.body,
  );
}
