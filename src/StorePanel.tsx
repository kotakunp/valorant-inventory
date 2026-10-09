import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { rarityColor, rarityLabel } from "./logic";
import { SkinArt } from "./skinArt";
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

/** Identity of the card a peek shows (rect/selected live on `Peek`). */
type PeekBase =
  | { key: string; kind: "skin"; offer: StoreOffer; nightMarket?: boolean }
  | { key: string; kind: "acc"; offer: AccessoryOffer };
/** The enlarged panel currently shown (a hover preview or the selection). */
type Peek = PeekBase & { rect: DOMRect };

function hhmmss(totalSec: number): string {
  const s = Math.max(0, totalSec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return [h, m, sec].map((v) => String(v).padStart(2, "0")).join(":");
}

/** Game-style section rule: — LABEL 06:43:04 — (shared with MatchesStrip). */
export function SectionHead({ label, time }: { label: string; time?: string | null }) {
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
        {art ? <SkinArt src={art} alt="" loading="lazy" weaponName={o.weaponName} /> : <span className="sstore-art-fb">?</span>}
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

  /* ---- Hover/tap peek: enlarged card anchored beside the trigger so the art
     can be inspected. Click / tap / Enter SELECTS a card, and only ever one
     card is selected at a time; hovering previews any card without disturbing
     that selection. Mirrors the showcase stack-spread 180ms leave grace. ---- */
  const [selected, setSelected] = useState<PeekBase | null>(null);
  const [peek, setPeek] = useState<Peek | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout>>();
  /** The card the shown peek belongs to, re-measured as the page scrolls. */
  const triggerRef = useRef<HTMLElement | null>(null);
  /** When the peek opened — a scroll must never kill it the instant it appears. */
  const openedAt = useRef(0);
  /** Last pointer position: lets a scroll tell "the card moved under me" apart
     from "I scrolled away", without depending on browser `:hover` timing. */
  const pointerAt = useRef<{ x: number; y: number } | null>(null);
  /** Latest keys, for the window listeners registered only once. */
  const shownRef = useRef<{ peekKey: string | null; selectedKey: string | null }>({
    peekKey: null,
    selectedKey: null,
  });
  /** Latest selection, for the 180ms grace timer (a touch tap selects *after*
     the pointerleave that starts it, so a captured value would be stale). */
  const selectedRef = useRef<PeekBase | null>(null);
  useEffect(() => {
    selectedRef.current = selected;
    shownRef.current = { peekKey: peek?.key ?? null, selectedKey: selected?.key ?? null };
  }, [peek, selected]);

  const keepOpen = () => clearTimeout(closeTimer.current);
  /** The cell for a peek key (`data-peek-key` is stamped by `cellProps`). */
  const cellEl = (key: string) =>
    document.querySelector<HTMLElement>(`[data-peek-key="${CSS.escape(key)}"]`);
  /** Show the selected card again — a hover preview just ended. */
  const showSelected = () => {
    const sel = selectedRef.current;
    const el = sel ? cellEl(sel.key) : null;
    if (!sel || !el) {
      setPeek(null);
      return;
    }
    triggerRef.current = el;
    setPeek({ ...sel, rect: el.getBoundingClientRect() });
  };
  const closeSoon = () => {
    keepOpen();
    // A selection survives the grace (touch fires pointerleave right after the
    // selecting tap); a hover preview simply falls back to it.
    closeTimer.current = setTimeout(() => {
      if (selectedRef.current) showSelected();
      else setPeek(null);
    }, 180);
  };
  useEffect(() => () => clearTimeout(closeTimer.current), []);

  /** Re-measure the trigger so the peek stays glued to its card (giving up
     once that card is gone from the DOM or scrolled out of view). */
  const follow = () => {
    const el = triggerRef.current;
    if (!el || !el.isConnected) {
      setPeek(null);
      return;
    }
    const rect = el.getBoundingClientRect();
    const onScreen =
      rect.bottom > 0 && rect.top < window.innerHeight && rect.right > 0 && rect.left < window.innerWidth;
    setPeek((p) => (p ? (onScreen ? { ...p, rect } : null) : p));
  };
  /** Pointer still on the card or on the peek? Answered from geometry so it
     survives a momentum scroll (which fires with no pointer movement at all). */
  const pointerOverCard = () => {
    const el = triggerRef.current;
    const p = pointerAt.current;
    if (!el || !p) return false;
    const holds = (r?: DOMRect) =>
      !!r && p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom;
    return (
      holds(el.getBoundingClientRect()) ||
      holds(document.querySelector(".sstore-peek")?.getBoundingClientRect())
    );
  };

  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setSelected(null);
      setPeek(null);
    };
    const resize = () => setPeek(null); // the anchor moved; the selection stays
    const track = (event: PointerEvent) => {
      pointerAt.current = { x: event.clientX, y: event.clientY };
    };
    const scroll = (event: Event) => {
      // The card scrolls WITH the page, so follow it rather than dismissing: a
      // macOS trackpad keeps firing momentum scroll events after the fingers
      // lift, which used to close the peek the instant it appeared.
      if (event.target instanceof Element && event.target.closest(".sstore-peek")) return;
      const { peekKey, selectedKey } = shownRef.current;
      if (!peekKey) return;
      // A selection is held open on purpose; only a hover preview can be
      // dropped, and then only once the pointer is genuinely off the card.
      if (selectedKey === peekKey || pointerOverCard() || Date.now() - openedAt.current < 500) follow();
      else setPeek(null);
    };
    const clickAway = (event: MouseEvent) => {
      const target = event.target;
      if (
        target instanceof Element &&
        (target.closest(".sstore-peek") || target.closest(".sstore-cell"))
      )
        return;
      setSelected(null);
      setPeek(null);
    };
    window.addEventListener("scroll", scroll, true);
    window.addEventListener("pointermove", track, { passive: true });
    window.addEventListener("resize", resize);
    window.addEventListener("keydown", escape);
    window.addEventListener("click", clickAway);
    return () => {
      window.removeEventListener("scroll", scroll, true);
      window.removeEventListener("pointermove", track);
      window.removeEventListener("resize", resize);
      window.removeEventListener("keydown", escape);
      window.removeEventListener("click", clickAway);
    };
  }, []);

  /** Hover (mouse/pen): preview a card. Never touches the selection — picking
   *  one is what the click path is for. */
  const cellEnter = (event: React.PointerEvent<HTMLDivElement>, base: PeekBase) => {
    if (event.pointerType === "touch") return; // tap is handled by the click path
    keepOpen();
    triggerRef.current = event.currentTarget;
    openedAt.current = Date.now();
    pointerAt.current = { x: event.clientX, y: event.clientY };
    setPeek({ ...base, rect: event.currentTarget.getBoundingClientRect() });
  };
  const cellLeave = () => closeSoon();
  /** Click/tap/Enter: select the card. Single selection — picking a card always
   *  releases the previous one, and picking the selected card again clears it. */
  const cellSelect = (el: HTMLElement, base: PeekBase) => {
    const rect = el.getBoundingClientRect();
    triggerRef.current = el;
    openedAt.current = Date.now();
    // A click leaves the pointer on the card; a keyboard pick has no
    // coordinates, so anchor to the centre — either way a later scroll can
    // still tell whether this card is what the user is looking at.
    pointerAt.current = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    const clearing = selected?.key === base.key;
    setSelected(clearing ? null : base);
    setPeek(clearing ? null : { ...base, rect });
  };
  const isSelected = (key: string) => selected?.key === key;
  /** Shared cell wiring: peek on hover, select on click/tap/Enter/Space. */
  const cellProps = (
    base: PeekBase
  ): React.ComponentPropsWithoutRef<"div"> & { "data-peek-key": string } => {
    const on = isSelected(base.key);
    return {
      "data-peek-key": base.key,
      className: `sstore-cell${on ? " is-selected" : ""}`,
      role: "button",
      tabIndex: 0,
      "aria-pressed": on,
      "aria-label": `Inspect ${base.offer.name}`,
      onPointerEnter: (event: React.PointerEvent<HTMLDivElement>) => cellEnter(event, base),
      onPointerLeave: cellLeave,
      onClick: (event: React.MouseEvent<HTMLDivElement>) => cellSelect(event.currentTarget, base),
      onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          cellSelect(event.currentTarget, base);
        }
      },
    };
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
              <div key={o.skinId} {...cellProps({ key: `skin:${o.skinId}`, kind: "skin", offer: o })}>
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
                key={o.skinId}
                {...cellProps({ key: `skin:${o.skinId}`, kind: "skin", offer: o, nightMarket: true })}
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
              <div key={o.id} {...cellProps({ key: `acc:${o.id}`, kind: "acc", offer: o })}>
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
 * the 1s countdown re-render plus a delayed pass re-anchor once the art loads,
 * and a scroll re-anchors it to the card instead of dismissing it.
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
      aria-label={`${peek.offer.name} enlarged preview`}
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
