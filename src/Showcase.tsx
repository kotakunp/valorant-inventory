import { useEffect, useRef, useState } from "react";
import { HoverSkins } from "./HoverSkins";
import type { ChromaSelection, RankBadge, ShowcasePayload, Selection, SkinItem, ItemKind } from "./types";
import { selKey } from "./types";
import type { GunGroup, Pages, StackDirection, StackLayer } from "./logic";
import {
  WEAPON_CATEGORIES,
  LOADOUT_GUNS,
  orderStack,
  rarityColor,
  stackDirectionForColumn,
  stackLayers,
  tierInfo,
  isPremiumSkin,
} from "./logic";

export const CANVAS_W = 1280;
export const CANVAS_H = 720;

const imgUrl = (u: string | null) => (u ? `/img/${encodeURIComponent(u)}` : null);
const fmt = (n: number) => n.toLocaleString("en-US");

interface Props {
  payload: ShowcasePayload;
  pages: Pages;
  page: number;
  selection: Selection;
  chromaSel?: ChromaSelection;
  /** gunId → skinId forced to the front of the stack */
  bringToFront?: Record<string, string>;
  onRemoveSkin?: (id: string) => void;
  onBringToFront?: (gunId: string, skinId: string) => void;
  onPickChroma?: (skinId: string, chromaId: string) => void;
}

function VLogo() {
  return <div className="sc-logo" aria-hidden="true" />;
}

function CatMark() {
  return (
    <svg className="sc-cat-icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path d="M8 1 L14 8 L8 15 L2 8 Z" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function KnifeIcon() {
  return (
    <svg viewBox="0 0 20 16" width="16" height="14" aria-hidden="true">
      <path d="M2 14 L12 2 L18 2 L8 14 Z" fill="#ff4655" />
      <path d="M12 2 L18 2 L16 5 Z" fill="#ece8e1" />
    </svg>
  );
}

/** Low-opacity weapon silhouette — fallback when no default render is available. */
function GunSilhouette() {
  return (
    <svg className="sc-silhouette" viewBox="0 0 72 26" aria-hidden="true" focusable="false">
      <path
        d="M3 10 H40 L46 7 H62 L64 9 H70 V13 H56 L52 15 H42 L38 22 H31 L29 15 H21 L17 22 H10 L13 15 H3 Z"
        fill="currentColor"
      />
      <path d="M31 15 H38 L36 24 H33 Z" fill="currentColor" />
    </svg>
  );
}

/** Dimmed official default-weapon render for empty loadout cells (fallback: silhouette). */
function EmptyGunArt({ icon }: { icon?: string }) {
  return icon ? (
    <img className="sc-empty-art" src={imgUrl(icon)!} alt="" />
  ) : (
    <GunSilhouette />
  );
}

/** Official currency display icons (valorant-api.com currencies) */
const VP_ICON =
  "https://media.valorant-api.com/currencies/85ad13f7-3d1b-5128-9eb2-7cd8ee0b5741/displayicon.png";
const RP_ICON =
  "https://media.valorant-api.com/currencies/e59aa87c-4cbf-517a-5983-6e81511be9b7/displayicon.png";

function CurrencyIcon({ src, alt }: { src: string; alt: string }) {
  return <img className="sc-wallet-icon" src={imgUrl(src) ?? undefined} alt={alt} />;
}

/** One compact row inside the rail's single RANK block (§11). */
function RankRow({ label, tier, badge }: { label: string; tier: number | null; badge?: RankBadge | null }) {
  const info = tierInfo(tier);
  const name = badge?.name ?? info.name;
  const color = badge?.color ?? info.color;
  const icon = badge?.icon ?? null;
  return (
    <div className="sc-rank-row">
      <span className="sc-rank-tag">{label}</span>
      {icon ? (
        <img className="sc-rank-icon" src={imgUrl(icon)!} alt="" />
      ) : (
        <span className="sc-rank-dot" style={{ background: color }} aria-hidden="true" />
      )}
      <span className="sc-rank-name" style={{ color }}>
        {name}
      </span>
    </div>
  );
}

export function Showcase({
  payload,
  pages,
  page,
  selection,
  chromaSel = {},
  bringToFront = {},
  onRemoveSkin,
  onBringToFront,
  onPickChroma,
}: Props) {
  const interactive = !!onRemoveSkin;
  const [hovered, setHovered] = useState<{ gun: string; skin?: string; rect: DOMRect } | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout>>();
  const keepOpen = () => clearTimeout(closeTimer.current);
  const closeSoon = () => {
    keepOpen();
    closeTimer.current = setTimeout(() => setHovered(null), 180);
  };
  const openStack = (element: HTMLElement, gun: string, skin?: string) => {
    keepOpen();
    setHovered({ gun, skin, rect: element.getBoundingClientRect() });
  };
  useEffect(() => () => clearTimeout(closeTimer.current), []);
  useEffect(() => {
    const close = () => setHovered(null);
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    const scroll = (event: Event) => {
      if (!(event.target instanceof Element) || !event.target.closest(".skin-hover-spread")) close();
    };
    window.addEventListener("scroll", scroll, true);
    window.addEventListener("resize", close);
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("scroll", scroll, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", escape);
    };
  }, []);

  const isOn = (kind: ItemKind, id: string) => !!selection[selKey(kind, id)];
  const checkedSkins = payload.skins.filter((s) => isOn("skin", s.id));
  // Shared premium rule (price / content tier / level fallback) — matches selection.
  const premCount = checkedSkins.filter((s) => isPremiumSkin(s)).length;
  const knifeCount = checkedSkins.filter((s) => s.isKnife).length;
  const checkedCards = payload.cards.filter((c) => isOn("card", c.id));
  const checkedTitles = payload.titles.filter((t) => isOn("title", t.id));
  const checkedBuddies = payload.buddies.filter((b) => isOn("buddy", b.id));
  const card = checkedCards.find((c) => c.equipped) ?? checkedCards[0];
  const title = checkedTitles.find((t) => t.equipped) ?? checkedTitles[0];
  const pageCount = pages.gridPages.length;
  const slots = pages.gridPages[page] ?? [];
  const knifeItems = pages.knifeItems ?? [];

  /** Exactly 4 category columns (+ OTHER for unknown guns); section titles mid-column when merged. */
  const catColumns: {
    id: string;
    dir: StackDirection;
    sections: { label: string; guns: GunGroup[] }[];
  }[] = (() => {
    const official = new Set(LOADOUT_GUNS.map((w) => w.toUpperCase()));
    const used = new Set<string>();
    const cols: {
      id: string;
      dir: StackDirection;
      sections: { label: string; guns: GunGroup[] }[];
    }[] = WEAPON_CATEGORIES.map((cat) => ({
      id: cat.id,
      dir: "down-right" as StackDirection,
      sections: cat.sections.map((sec) => {
        const ids = sec.guns.map((w) => w.toUpperCase());
        const guns = slots.filter((g) => {
          if (used.has(g.id) || !ids.includes(g.id)) return false;
          used.add(g.id);
          return true;
        });
        return { label: sec.label as string, guns };
      }),
    }));
    const other = slots.filter((g) => {
      if (used.has(g.id) || official.has(g.id)) return false;
      used.add(g.id);
      return true;
    });
    if (other.length) cols.push({ id: "other", dir: "down-left", sections: [{ label: "OTHER", guns: other }] });
    // Deterministic two-axis direction per column (§14): left half cascades down-right, right half down-left.
    cols.forEach((c, i) => {
      c.dir = stackDirectionForColumn(i, cols.length);
    });
    return cols;
  })();

  const activeChroma = (s: SkinItem) => {
    const id = chromaSel[s.id] ?? s.defaultChromaId ?? s.chromas[0]?.id;
    return s.chromas.find((c) => c.id === id) ?? null;
  };

  const tileIcon = (s: SkinItem) => activeChroma(s)?.icon ?? s.icon;

  /** Artwork never changes its hit area or layer order on hover. */
  const stackItem = (s: SkinItem, index: number, _gunId: string, layer: StackLayer, count: number) => (
    <div key={s.id} className="sc-stack-item" style={{
      zIndex: count - index + 1,
      transform: `translate(${layer.dx * 100}%, ${layer.dy * 100}%) scale(${layer.scale})`,
      ["--rarity" as string]: rarityColor(s.price, s.levelCount, s.contentTierRank ?? null),
    }}>
      {tileIcon(s) ? <span className="sc-stack-frame"><img className="sc-stack-art" src={imgUrl(tileIcon(s))!} alt="" /></span>
        : <span className="sc-fallback">{s.weaponName}</span>}
    </div>
  );

  const gunSection = (gun: GunGroup, dir: StackDirection) => {
    const items = orderStack(gun.items, bringToFront[gun.id]);
    const empty = items.length === 0;
    const layers = stackLayers(items.length, dir);
    return (
      <section className={`sc-cat${empty ? " sc-cat--empty" : ""}`} key={gun.id}>
        {interactive && !empty && (
          <button className="sc-hover-target" aria-label={`Browse ${gun.label}, ${items.length} skins`}
            onPointerEnter={e => openStack(e.currentTarget, gun.id)} onPointerLeave={closeSoon}
            onFocus={e => openStack(e.currentTarget, gun.id)} onBlur={closeSoon}
            onClick={e => openStack(e.currentTarget, gun.id)} />
        )}
        <div className="sc-cat-head">
          <CatMark />
          <span className="sc-cat-name">{gun.label}</span>
          <span className="sc-cat-rule" aria-hidden="true" />
          {!empty && items.length > 1 && <span className="sc-stack-count">{items.length}</span>}
        </div>
        <div
          className={`sc-stack${items.length > 1 ? " is-stacked" : ""}${empty ? " sc-stack--empty" : ""}`}
        >
          {empty ? (
            <div className="sc-empty-gun">
              <EmptyGunArt icon={payload.defaultIcons?.[gun.id]} />
            </div>
          ) : (
            items.map((s, i) => stackItem(s, i, gun.id, layers[i], items.length))
          )}
        </div>
      </section>
    );
  };

  return (
    <div className="sc-root">
      {interactive && hovered && (
        <HoverSkins
          gun={hovered.gun}
          items={hovered.gun === "MELEE" ? knifeItems.filter(s => s.id === hovered.skin) : orderStack(slots.find(g => g.id === hovered.gun)?.items ?? [], bringToFront[hovered.gun])}
          rect={hovered.rect} chromas={chromaSel}
          onEnter={keepOpen} onLeave={closeSoon}
          onFront={onBringToFront} onRemove={onRemoveSkin} onChroma={onPickChroma}
        />
      )}
      <div className="sc-wedge" />
      <header className="sc-header">
        <VLogo />
        <span className="sc-header-div" aria-hidden="true" />
        <div className="sc-title">COLLECTION</div>
        <div className="sc-header-rule" aria-hidden="true" />
      </header>

      <div className="sc-body">
        <main className={`sc-center density-${pages.density.name}`}>
          <div className="sc-loadout">
            {catColumns.map((col) => (
              <div className="sc-cat-col" key={col.id}>
                {col.sections.map((sec, si) => (
                  <div className="sc-cat-sec" key={sec.label}>
                    <div className={`sc-cat-col-head${si > 0 ? " sc-cat-col-head--mid" : ""}`}>
                      <span className="sc-cat-col-label">{sec.label}</span>
                      <span className="sc-cat-col-rule" aria-hidden="true" />
                    </div>
                    <div className="sc-cat-sec-guns">{sec.guns.map((g) => gunSection(g, col.dir))}</div>
                  </div>
                ))}
              </div>
            ))}
            {catColumns.length === 0 && (
              <div className="sc-empty sc-empty--loadout">
                {pages.totalSelected === 0 ? "NO SKINS SELECTED" : pageCount > 1 ? "SEE PAGE 1" : "NO SKINS"}
              </div>
            )}
            <div className="sc-knife-row">
              <div className="sc-cat-head sc-cat-head--sm">
                <KnifeIcon />
                <span className="sc-cat-name">MELEE</span>
                <span className="sc-cat-rule" aria-hidden="true" />
                {knifeItems.length > 0 && <span className="sc-stack-count">{knifeItems.length}</span>}
              </div>
              <div className="sc-knife-strip">
                {knifeItems.length > 0 ? (
                  knifeItems.map((s) => (
                    <div className="sc-knife-cell" key={s.id}>
                      {interactive && <button className="sc-hover-target" aria-label={`Browse ${s.name}`}
                        onPointerEnter={e => openStack(e.currentTarget, "MELEE", s.id)} onPointerLeave={closeSoon}
                        onFocus={e => openStack(e.currentTarget, "MELEE", s.id)} onBlur={closeSoon}
                        onClick={e => openStack(e.currentTarget, "MELEE", s.id)} />}
                      <div className="sc-stack">
                        {stackItem(s, 0, "MELEE", { dx: 0, dy: 0, scale: 1 }, 1)}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="sc-knife-cell sc-knife-cell--empty">
                    <div className="sc-stack sc-stack--empty">
                      <div className="sc-empty-gun">
                        <EmptyGunArt icon={payload.defaultIcons?.["MELEE"]} />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </main>

        <aside className="sc-right">
          {card && (
            <div className="sc-card-panel">
              {card.icon ? <img src={imgUrl(card.icon)!} alt="" /> : <div className="sc-fallback">{card.name}</div>}
              {/* VALORANT profile-style identity over the card art */}
              <div className="sc-card-identity">
                {title && <div className="sc-card-title">{title.text}</div>}
                <div className="sc-card-user">
                  {payload.gameName}
                  {payload.tagLine && <span className="sc-card-tag">#{payload.tagLine}</span>}
                </div>
                {payload.accountLevel != null && (
                  <div className="sc-card-level">LV. {payload.accountLevel}</div>
                )}
              </div>
              {checkedCards.length > 1 && <div className="sc-more">+{checkedCards.length - 1} MORE</div>}
            </div>
          )}
          <div className="sc-rank-block">
            <div className="sc-rank-block-label">RANK</div>
            <RankRow label="PEAK" tier={payload.ranks.peak} badge={payload.ranks.peakBadge} />
            <RankRow label="CURRENT" tier={payload.ranks.current} badge={payload.ranks.currentBadge} />
          </div>
          {(payload.wallet.vp != null || payload.wallet.rp != null) && (
            <div className="sc-wallet">
              {payload.wallet.vp != null && (
                <span className="sc-chip">
                  <CurrencyIcon src={VP_ICON} alt="VP" />
                  {fmt(payload.wallet.vp)}
                </span>
              )}
              {payload.wallet.rp != null && (
                <span className="sc-chip">
                  <CurrencyIcon src={RP_ICON} alt="RP" />
                  {fmt(payload.wallet.rp)}
                </span>
              )}
            </div>
          )}
          <div className="sc-summary">
            <span>PREMIUM {premCount}</span>
            <span aria-hidden="true">·</span>
            <span>KNIFE {knifeCount}</span>
            <span aria-hidden="true">·</span>
            <span>BUDDIES +{checkedBuddies.length}</span>
          </div>
        </aside>
      </div>
    </div>
  );
}
