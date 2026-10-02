import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { rarityColor, rarityLabel } from "./logic";
import type { AccessoryOffer, StoreOffer, StoreSection } from "./types";

const imgUrl = (u: string | null) => (u ? `/img/${encodeURIComponent(u)}` : null);
const fmt = (n: number) => n.toLocaleString("en-US");

/** #rrggbb → #rrggbbaa (rarity-tinted card outline). */
const hexA = (hex: string, a: number) =>
  `${hex}${Math.round(a * 255).toString(16).padStart(2, "0")}`;

const VP_ICON =
  "https://media.valorant-api.com/currencies/85ad13f7-3d1b-5128-9eb2-7cd8ee0b5741/displayicon.png";
const KC_ICON =
  "https://media.valorant-api.com/currencies/85ca954a-41f2-ce94-9b45-8ca3dd39a00d/displayicon.png";

const KIND_LABEL: Record<AccessoryOffer["kind"], string> = {
  spray: "SPRAY",
  buddy: "BUDDY",
  card: "CARD",
  title: "TITLE",
};

/** Identity of the card a peek shows (rect/pinned live on `Peek`). */
type PeekBase =
  | { key: string; kind: "skin"; offer: StoreOffer; nightMarket?: boolean }
  | { key: string; kind: "acc"; offer: AccessoryOffer };
type Peek = PeekBase & { rect: DOMRect; pinned: boolean };

function hhmmss(totalSec: number): string {
  const s = Math.max(0, totalSec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return [h, m, sec].map((v) => String(v).padStart(2, "0")).join(":");
}

function SectionHead({ label, time }: { label: string; time?: string | null }) {
  return (
    <div className="sstore-head">
      <span className="sstore-head-line" />
      <span className="sstore-head-title">{label}</span>
      {time && <span className="sstore-head-time">{time}</span>}
      <span className="sstore-head-line" />
    </div>
  );
}

function SkinCard({ o, nightMarket }: { o: StoreOffer; nightMarket?: boolean }) {
  const art = imgUrl(o.icon);
  const rarity = rarityColor(o.price, 0, o.contentTierRank ?? null);
  // Night-market discount tag: Riot sends DiscountPercent; fall back to the price math.
  const pctFromPrices =
    o.price != null && o.price > 0 && o.discountPrice != null
      ? Math.round((1 - o.discountPrice / o.price) * 100)
      : null;
  const discountPct = nightMarket ? o.discountPercent ?? pctFromPrices : null;
  return (
    <article
      className="sstore-card"
      title={o.name}
      style={{ borderColor: hexA(rarity, 0.55), "--rarity": rarity } as React.CSSProperties}
    >
      <div className="sstore-art">
        {art ? <img src={art} alt="" loading="lazy" /> : <span className="sstore-art-fb">?</span>}
      </div>
      {discountPct != null && discountPct > 0 && (
        <span className="sstore-discount">−{discountPct}%</span>
      )}
      <div className="sstore-bar">
        <div className="sstore-meta">
          <span className="sstore-name">{o.name}</span>
          <span className="sstore-rarity">
            {o.contentTierIcon && <img className="sstore-rarity-gem" src={imgUrl(o.contentTierIcon)!} alt="" />}
            {rarityLabel(o.price, 0, o.contentTierRank ?? null)}
          </span>
        </div>
        {nightMarket && o.discountPrice != null ? (
          <span className="sstore-price sstore-price--nm">
            {o.price != null && <s>{fmt(o.price)}</s>}
            <strong>
              {o.discountPrice != null ? fmt(o.discountPrice) : "—"} <img src={imgUrl(VP_ICON)!} alt="VP" />
            </strong>
          </span>
        ) : (
          <span className="sstore-price">
            {o.price != null ? (
              <>
                {fmt(o.price)} <img src={imgUrl(VP_ICON)!} alt="VP" />
              </>
            ) : (
              <span className="sstore-price-na">—</span>
            )}
          </span>
        )}
        {o.owned && <span className="sstore-owned">OWNED</span>}
      </div>
    </article>
  );
}

function AccessoryCard({ o }: { o: AccessoryOffer }) {
  const art = imgUrl(o.icon);
  return (
    <article className="sstore-card" title={o.name}>
      <div className="sstore-art">
        {art ? <img src={art} alt="" loading="lazy" /> : <span className="sstore-art-fb">{KIND_LABEL[o.kind]}</span>}
      </div>
      <div className="sstore-bar">
        <span className="sstore-name">{o.name}</span>
        <span className="sstore-price">
          {o.price != null ? (
            <>
              {fmt(o.price)} <img src={imgUrl(KC_ICON)!} alt="KC" />
            </>
          ) : (
            <span className="sstore-price-na">—</span>
          )}
        </span>
      </div>
    </article>
  );
}

/**
 * Store strip under the showcase (editor-only, never exported) — in-game look:
 * DAILY OFFERS with HH:MM:SS countdown, night market, Kingdom-Credit accessories.
 */
export function StorePanel({
  store,
  generatedAt,
  width,
}: {
  store: StoreSection;
  generatedAt: string;
  /** Matches the preview frame width so the strip hugs the canvas at any zoom. */
  width?: number;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  /* ---- Hover/tap peek: enlarged card anchored beside the trigger so the
     art can be inspected. Mirrors the showcase stack-spread pattern
     (180ms leave grace, Escape/resize/scroll dismiss) plus a click pin so
     touch users (no hover) can inspect too. ---- */
  const [peek, setPeek] = useState<Peek | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout>>();
  const keepOpen = () => clearTimeout(closeTimer.current);
  const closeSoon = () => {
    keepOpen();
    // Pinned peeks survive the grace — touch fires pointerleave right after the pinning tap.
    closeTimer.current = setTimeout(() => setPeek((p) => (p && p.pinned ? p : null)), 180);
  };
  useEffect(() => () => clearTimeout(closeTimer.current), []);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPeek(null);
    };
    const close = () => setPeek(null);
    const scroll = (event: Event) => {
      if (!(event.target instanceof Element) || !event.target.closest(".sstore-peek")) setPeek(null);
    };
    const clickAway = (event: MouseEvent) => {
      const target = event.target;
      setPeek((p) => {
        if (!p || !p.pinned) return p;
        if (
          target instanceof Element &&
          (target.closest(".sstore-peek") || target.closest(".sstore-cell"))
        )
          return p;
        return null;
      });
    };
    window.addEventListener("scroll", scroll, true);
    window.addEventListener("resize", close);
    window.addEventListener("keydown", escape);
    window.addEventListener("click", clickAway);
    return () => {
      window.removeEventListener("scroll", scroll, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", escape);
      window.removeEventListener("click", clickAway);
    };
  }, []);

  /** Hover (mouse/pen): transient peek; re-hovering a pinned card keeps it pinned. */
  const cellEnter = (event: React.PointerEvent<HTMLDivElement>, base: PeekBase) => {
    if (event.pointerType === "touch") return; // tap is handled by the click path
    keepOpen();
    const rect = event.currentTarget.getBoundingClientRect();
    setPeek((prev) => ({
      ...base,
      rect,
      pinned: prev != null && prev.key === base.key ? prev.pinned : false,
    }));
  };
  const cellLeave = () => closeSoon();
  /** Click/tap: pin the peek open (tapping the same card again closes it). */
  const cellClick = (event: React.MouseEvent<HTMLDivElement>, base: PeekBase) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setPeek((prev) =>
      prev != null && prev.key === base.key && prev.pinned
        ? null
        : { ...base, rect, pinned: true }
    );
  };

  const expiryMs =
    store.secondsToReset != null ? Date.parse(generatedAt) + store.secondsToReset * 1000 : null;
  const resetLeft = expiryMs != null ? Math.round((expiryMs - now) / 1000) : null;

  const hasDaily = store.offers.length > 0;
  const hasNight = store.nightMarket.length > 0;
  const hasAcc = store.accessories.length > 0;
  if (!hasDaily && !hasNight && !hasAcc) return null;

  return (
    <div className="store-strip" style={width ? { width } : undefined}>
      {hasDaily && (
        <section>
          <SectionHead label="DAILY OFFERS" time={resetLeft != null && resetLeft > 0 ? hhmmss(resetLeft) : null} />
          <div className="sstore-row sstore-row--daily">
            {store.offers.map((o) => (
              <div
                className="sstore-cell"
                key={o.skinId}
                onPointerEnter={(e) => cellEnter(e, { key: `skin:${o.skinId}`, kind: "skin", offer: o })}
                onPointerLeave={cellLeave}
                onClick={(e) => cellClick(e, { key: `skin:${o.skinId}`, kind: "skin", offer: o })}
              >
                <SkinCard o={o} />
              </div>
            ))}
          </div>
        </section>
      )}
      {hasNight && (
        <section>
          <SectionHead label="NIGHT MARKET" />
          <div className="sstore-row">
            {store.nightMarket.map((o) => (
              <div
                className="sstore-cell"
                key={o.skinId}
                onPointerEnter={(e) =>
                  cellEnter(e, { key: `skin:${o.skinId}`, kind: "skin", offer: o, nightMarket: true })
                }
                onPointerLeave={cellLeave}
                onClick={(e) =>
                  cellClick(e, { key: `skin:${o.skinId}`, kind: "skin", offer: o, nightMarket: true })
                }
              >
                <SkinCard o={o} nightMarket />
              </div>
            ))}
          </div>
        </section>
      )}
      {hasAcc && (
        <section>
          <SectionHead label="ACCESSORIES" />
          <div className="sstore-row sstore-row--scroll">
            {store.accessories.map((o) => (
              <div
                className="sstore-cell"
                key={o.id}
                onPointerEnter={(e) => cellEnter(e, { key: `acc:${o.id}`, kind: "acc", offer: o })}
                onPointerLeave={cellLeave}
                onClick={(e) => cellClick(e, { key: `acc:${o.id}`, kind: "acc", offer: o })}
              >
                <AccessoryCard o={o} />
              </div>
            ))}
          </div>
        </section>
      )}
      {peek && (
        <StorePeek key={peek.key} peek={peek} onEnter={keepOpen} onLeave={closeSoon} />
      )}
    </div>
  );
}

/**
 * Portal peek: the same card markup, enlarged, art at its natural aspect
 * ratio (no fixed box, no crop). Anchored beside the trigger when there's
 * room, centered over it otherwise, clamped to the viewport after measuring —
 * the 1s countdown re-render plus a delayed pass re-anchor once the art loads.
 */
function StorePeek({
  peek,
  onEnter,
  onLeave,
}: {
  peek: Peek;
  onEnter: () => void;
  onLeave: () => void;
}) {
  const ref = useRef<HTMLElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [, force] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const r = peek.rect;
    const left =
      vw - r.right >= w + 16
        ? r.right + 8
        : r.left >= w + 16
          ? r.left - w - 8
          : Math.max(12, Math.min(r.left + r.width / 2 - w / 2, vw - w - 12));
    const top = Math.max(12, Math.min(r.top, vh - h - 12));
    setPos((p) => (p && p.left === left && p.top === top ? p : { left, top }));
  });
  // Art loads after first paint — one delayed pass re-clamps the position.
  useEffect(() => {
    const t = setTimeout(() => force((n) => n + 1), 450);
    return () => clearTimeout(t);
  }, []);

  const body =
    peek.kind === "skin" ? (
      <SkinCard o={peek.offer} nightMarket={peek.nightMarket} />
    ) : (
      <AccessoryCard o={peek.offer} />
    );

  return createPortal(
    <aside
      ref={ref}
      className="sstore-peek"
      aria-label={`Inspect ${peek.offer.name}`}
      style={{
        left: pos?.left ?? peek.rect.left,
        top: pos?.top ?? peek.rect.top,
        visibility: pos ? "visible" : "hidden",
      }}
      onPointerEnter={onEnter}
      onPointerLeave={onLeave}
    >
      {body}
    </aside>,
    document.fullscreenElement ?? document.body
  );
}
