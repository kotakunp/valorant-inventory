import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CardItem } from "./types";
import { peekPosition } from "./logic";

const img = (url: string) => `/img/${encodeURIComponent(url)}`;
const fmt = (n: number) => n.toLocaleString("en-US");

/**
 * Sidebar card peek — the chips in the CARDS panel only carry a 16px square
 * avatar (`CardItem.avatar`), so hovering one reveals the full 268×640
 * portrait (`CardItem.icon`) at its natural aspect ratio, uncropped, beside
 * the chip. Positioned by the shared `peekPosition` helper.
 *
 * It re-anchors to `anchor` as the page scrolls rather than dismissing, so a
 * trackpad momentum scroll can't kill it (same rule as the store peek).
 * App.tsx owns the open/close; `onEnter`/`onLeave` keep it alive while the
 * pointer crosses the gap onto the panel itself, `onClose` handles Escape.
 */
export function CardPeek({
  item,
  anchor,
  onEnter,
  onLeave,
  onClose,
}: {
  item: CardItem;
  anchor: HTMLElement;
  onEnter: () => void;
  onLeave: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLElement>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [, force] = useState(0);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  // Track the chip: opening, then following it through scrolls. A chip clipped
  // out by a scrolling ancestor (.chips / .controls) or moved off-screen ends
  // the peek instead of floating over empty space — same rule as StorePeek.
  useLayoutEffect(() => {
    const visibleRect = (): DOMRect | null => {
      const r = anchor.getBoundingClientRect();
      if (r.bottom <= 0 || r.top >= window.innerHeight || r.right <= 0 || r.left >= window.innerWidth) {
        return null;
      }
      for (let p = anchor.parentElement; p && p !== document.body; p = p.parentElement) {
        const cs = getComputedStyle(p);
        if (cs.overflowX === "visible" && cs.overflowY === "visible") continue;
        const b = p.getBoundingClientRect();
        if (r.bottom <= b.top || r.top >= b.bottom || r.right <= b.left || r.left >= b.right) return null;
      }
      return r;
    };
    const start = visibleRect();
    if (!start) {
      closeRef.current();
      return;
    }
    setRect(start);
    const follow = (event: Event) => {
      if (event.target instanceof Element && event.target.closest(".chip-peek")) return;
      const next = visibleRect();
      if (!next) return closeRef.current();
      setRect(next);
    };
    const resize = () => closeRef.current(); // the sidebar reflowed; the anchor moved
    window.addEventListener("scroll", follow, true);
    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("scroll", follow, true);
      window.removeEventListener("resize", resize);
    };
  }, [anchor]);

  // Anchor + measure, then re-measure when the portrait finishes loading.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !rect) return;
    const next = peekPosition(rect, { width: el.offsetWidth, height: el.offsetHeight }, {
      width: window.innerWidth,
      height: window.innerHeight,
    });
    setPos((p) => (p && p.left === next.left && p.top === next.top ? p : next));
  });
  // Escape dismisses (same contract as the store peek).
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeRef.current();
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, []);

  if (!rect) return null;
  return createPortal(
    <aside
      ref={ref}
      className="chip-peek"
      aria-label={`${item.name} enlarged preview`}
      style={{
        left: pos?.left ?? rect.left,
        top: pos?.top ?? rect.top,
        visibility: pos ? "visible" : "hidden",
      }}
      onPointerEnter={onEnter}
      onPointerLeave={onLeave}
    >
      {item.icon ? (
        <img
          src={img(item.icon)}
          alt=""
          // Re-measure from the real intrinsic box once the portrait lands, so a
          // slow /img proxy can't leave the panel mispositioned.
          onLoad={() => force((n) => n + 1)}
          onError={() => force((n) => n + 1)}
        />
      ) : (
        <div className="chip-peek-fb">{item.name}</div>
      )}
      <div className="chip-peek-bar">
        <span className="chip-peek-name">{item.name}</span>
        <span className="chip-peek-meta">
          {item.equipped && <span className="chip-peek-eq">EQUIPPED</span>}
          {item.price != null && <span className="chip-peek-price">{fmt(item.price)} VP</span>}
        </span>
      </div>
    </aside>,
    document.fullscreenElement ?? document.body
  );
}