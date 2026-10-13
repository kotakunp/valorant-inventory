import { useEffect, useRef, useState, type CSSProperties } from "react";
import { HoverSkins } from "./HoverSkins";
import type { ChromaSelection, RankBadge, ShowcaseOptions, ShowcasePayload, Selection, SkinItem, ItemKind } from "./types";
import { DEFAULT_OPTIONS, selKey } from "./types";
import type { GunGroup, Pages } from "./logic";
import { SkinArt, skinArtStyle } from "./skinArt";
import { thumb } from "./thumb";
import {
  WEAPON_CATEGORIES,
  LOADOUT_GUNS,
  accountValue,
  orderStack,
  rarityColor,
  gunStack,
  GUN_SPREAD_MAX,
  cellWeight,
  knifeLayout,
  tierInfo,
  isPremiumSkin,
  vpToUsd,
} from "./logic";

export const CANVAS_W = 1280;
export const CANVAS_H = 1024;

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
  /** Hover spread without editing (shared links); defaults to `!!onRemoveSkin`. */
  hoverable?: boolean;
  /** FM badge / hidden Riot ID. */
  options?: ShowcaseOptions;
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
function EmptyGunArt({ icon, weaponName }: { icon?: string; weaponName: string }) {
  return icon ? (
    <SkinArt className="sc-empty-art" src={imgUrl(icon)!} alt="" weaponName={weaponName} />
  ) : (
    <div className="sc-silhouette-wrap" style={skinArtStyle(weaponName)}>
      <GunSilhouette />
    </div>
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

/** Rank medallion panel in the rail (bordered tier badge + tier-colored name). */
function Medallion({ label, tier, badge }: { label: string; tier: number | null; badge?: RankBadge | null }) {
  const info = tierInfo(tier);
  const name = badge?.name ?? info.name;
  const color = badge?.color ?? info.color;
  const icon = badge?.icon ?? null;
  return (
    <div className="sc-rank-panel">
      <div className="sc-medal-label">
        <span className="sc-rank-caret" aria-hidden="true" />
        {label}
      </div>
      <div className="sc-medal-badge" style={{ borderColor: color }}>
        {icon ? (
          <img className="sc-medal-icon" src={imgUrl(icon)!} alt={name} title={name} />
        ) : (
          <span className="sc-medal-fallback" style={{ color }}>
            {name}
          </span>
        )}
      </div>
      <div className="sc-medal-name" style={{ color }}>
        {name}
      </div>
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
  hoverable,
  options = DEFAULT_OPTIONS,
}: Props) {
  const interactive = hoverable ?? !!onRemoveSkin;
  const [hovered, setHovered] = useState<{ gun: string; rect: DOMRect } | null>(null);
  // Skin under the pointer inside a stack: outlined on the canvas and in the spread.
  const [hot, setHot] = useState<string | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout>>();
  const keepOpen = () => clearTimeout(closeTimer.current);
  const closeSoon = () => {
    keepOpen();
    closeTimer.current = setTimeout(() => setHovered(null), 180);
  };
  const openStack = (element: HTMLElement, gun: string) => {
    keepOpen();
    setHovered((h) => (h?.gun === gun ? h : { gun, rect: element.getBoundingClientRect() }));
  };
  /** Front-most visible art under the pointer (layers are tagged front-first). */
  const trackHot = (event: React.PointerEvent<HTMLElement>) => {
    const host = event.currentTarget.parentElement;
    const arts = host ? Array.from(host.querySelectorAll<HTMLElement>("[data-layer]")) : [];
    arts.sort((a, b) => Number(a.dataset.layer) - Number(b.dataset.layer));
    const hit = arts.find((el) => {
      const r = (el.querySelector("img") ?? el).getBoundingClientRect();
      return event.clientX >= r.left && event.clientX <= r.right && event.clientY >= r.top && event.clientY <= r.bottom;
    });
    setHot(hit?.dataset.skin ?? null);
  };
  useEffect(() => () => clearTimeout(closeTimer.current), []);
  useEffect(() => {
    const close = () => { setHovered(null); setHot(null); };
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
  // Whole account's list-price value, selected or not (hidden when 0 / priceless).
  const totalVp = accountValue(payload);
  const checkedCards = payload.cards.filter((c) => isOn("card", c.id));
  const checkedTitles = payload.titles.filter((t) => isOn("title", t.id));
  const checkedBuddies = payload.buddies.filter((b) => isOn("buddy", b.id));
  const card = checkedCards.find((c) => c.equipped) ?? checkedCards[0];
  const title = checkedTitles.find((t) => t.equipped) ?? checkedTitles[0];
  // Single "main agent" slot (radio-style pick); absent → no tile at all.
  const agent = (payload.agents ?? []).find((a) => isOn("agent", a.id));
  const pageCount = pages.gridPages.length;
  const slots = pages.gridPages[page] ?? [];
  const knifeItems = pages.knifeItems ?? [];

  /** Exactly 4 category columns (+ OTHER for unknown guns); section titles mid-column when merged. */
  const catColumns: {
    id: string;
    sections: { label: string; guns: GunGroup[] }[];
  }[] = (() => {
    const official = new Set(LOADOUT_GUNS.map((w) => w.toUpperCase()));
    const used = new Set<string>();
    const cols: {
      id: string;
      sections: { label: string; guns: GunGroup[] }[];
    }[] = WEAPON_CATEGORIES.map((cat) => ({
      id: cat.id,
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
    if (other.length) cols.push({ id: "other", sections: [{ label: "OTHER", guns: other }] });
    return cols;
  })();

  const activeChroma = (s: SkinItem) => {
    const id = chromaSel[s.id] ?? s.defaultChromaId ?? s.chromas[0]?.id;
    return s.chromas.find((c) => c.id === id) ?? null;
  };

  const tileIcon = (s: SkinItem) => activeChroma(s)?.icon ?? s.icon;

  const rarityOf = (s: SkinItem) => rarityColor(s.price, s.levelCount, s.contentTierRank ?? null);

  const skinArt = (s: SkinItem, artStyle?: CSSProperties) =>
    tileIcon(s) ? <span className="sc-stack-frame"><SkinArt className="sc-stack-art" src={imgUrl(tileIcon(s))!} alt="" weaponName={s.weaponName} isKnife={s.isKnife} style={artStyle} /></span>
      : <span className="sc-fallback" style={artStyle}>{s.weaponName}</span>;

  /**
   * Artwork never changes its hit area or layer order on hover. `pos` places
   * the skin inside its stack (inline, from `gunStack` / `knifeLayout`).
   */
  const stackItem = (s: SkinItem, index: number, pos: CSSProperties, z: number, variant?: "up" | "knife", artStyle?: CSSProperties) => (
    <div key={s.id} data-layer={index} data-skin={s.id}
      className={`sc-stack-item${variant ? ` sc-stack-item--${variant}` : ""}${index > 0 && variant === "up" ? " is-back" : ""}${hot === s.id ? " is-hot" : ""}`}
      style={{ ...pos, zIndex: z, ["--rarity" as string]: rarityOf(s) }}>
      {skinArt(s, artStyle)}
    </div>
  );

  const hoverTarget = (gun: string, label: string) => interactive && (
    <button className="sc-hover-target" aria-label={label}
      onPointerEnter={e => { openStack(e.currentTarget, gun); trackHot(e); }}
      onPointerMove={trackHot}
      onPointerLeave={() => { setHot(null); closeSoon(); }}
      onFocus={e => openStack(e.currentTarget, gun)} onBlur={closeSoon}
      onClick={e => openStack(e.currentTarget, gun)} />
  );

  /**
   * Vertical distance between neighbouring skins. In translate, % is the art's
   * own height and cqh is the cell (`.sc-stack` is a size container). Wide guns
   * are width-limited, so in a tall cell `peek` × art height alone leaves the
   * group bunched in the middle; the step therefore grows to spread the group
   * over ~92% of the cell, capped so neighbours still overlap (≤ 75% revealed).
   */
  const spreadStep = (stack: ReturnType<typeof gunStack>) =>
    stack.visible > 1
      ? `clamp(${stack.peek * 100}%, (92cqh - 100%) / ${stack.visible - 1}, ${GUN_SPREAD_MAX * 100}%)`
      : "0px";

  const gunSection = (gun: GunGroup) => {
    const items = orderStack(gun.items, bringToFront[gun.id]);
    const empty = items.length === 0;
    const stack = gunStack(items.length);
    const shown = items.slice(0, stack.visible);
    const front = items[0];
    return (
      <section
        className={`sc-cat${empty ? " sc-cat--empty" : ""}`}
        key={gun.id}
        style={{ flexGrow: cellWeight(items.length), ...(front ? ({ "--rarity": rarityOf(front) } as CSSProperties) : {}) }}
      >
        {!empty && hoverTarget(gun.id, `Browse ${gun.label}, ${items.length} skins`)}
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
              <EmptyGunArt icon={payload.defaultIcons?.[gun.id]} weaponName={gun.id === "MELEE" ? "Melee" : gun.label} />
            </div>
          ) : (
            shown.map((s, i) =>
              items.length > 1
                ? stackItem(
                    s, i,
                    { inset: "auto 0", top: `${((1 - stack.box) / 2) * 100}%`, height: `${stack.box * 100}%` },
                    shown.length - i + 1, "up",
                    { transform: `translateY(calc(${(stack.visible - 1) / 2 - i} * ${spreadStep(stack)}))` }
                  )
                : stackItem(s, i, {}, 1)
            )
          )}
        </div>
      </section>
    );
  };

  const hasExtras = payload.wallet.vp != null || payload.wallet.rp != null || options.fm;

  const knives = orderStack(knifeItems, bringToFront.MELEE);
  const knifeGrid = knifeLayout(knives.length);
  const knifePos = (i: number): CSSProperties => {
    const { row, left } = knifeGrid.slots[i];
    const rowH = 100 / knifeGrid.rows;
    // Longhands only: React clears a dropped key to "", so a shorthand like `inset`
    // would fall back to the stylesheet's `inset: 0` and pin every knife to one spot.
    return {
      top: `${row * rowH}%`,
      left: `${left * 100}%`,
      right: "auto",
      bottom: "auto",
      height: `${rowH}%`,
      width: `${knifeGrid.box * 100}%`,
    };
  };

  return (
    <div className="sc-root">
      {interactive && hovered && (
        <HoverSkins
          gun={hovered.gun}
          items={hovered.gun === "MELEE" ? knives : orderStack(slots.find(g => g.id === hovered.gun)?.items ?? [], bringToFront[hovered.gun])}
          rect={hovered.rect} chromas={chromaSel} hot={hot}
          onEnter={keepOpen} onLeave={closeSoon}
          onFront={onBringToFront} onRemove={onRemoveSkin} onChroma={onPickChroma}
        />
      )}
      <div className="sc-wedge" />

      <div className="sc-body">
        <main className={`sc-center density-${pages.density.name}`}>
          <div className="sc-loadout">
            {catColumns.map((col) => (
              <div className="sc-cat-col" key={col.id}>
                {col.sections.map((sec, si) => (
                  <div className="sc-cat-sec" key={sec.label}
                    style={{ flexGrow: sec.guns.reduce((sum, g) => sum + cellWeight(g.items.length), 0) || 1 }}>
                    <div className={`sc-cat-col-head${si > 0 ? " sc-cat-col-head--mid" : ""}`}>
                      <span className="sc-cat-col-label">{sec.label}</span>
                      <span className="sc-cat-col-rule" aria-hidden="true" />
                    </div>
                    <div className="sc-cat-sec-guns">{sec.guns.map((g) => gunSection(g))}</div>
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
              <div className={`sc-knife-plane${knives.length ? "" : " sc-knife-plane--empty"}`}
                style={knives[0] ? ({ "--rarity": rarityOf(knives[0]) } as CSSProperties) : undefined}>
                {knives.length > 0 && hoverTarget("MELEE", `Browse melee, ${knives.length} skins`)}
                {knives.length > 0 ? (
                  <div className="sc-stack sc-knife-stack">
                    {knives.map((s, i) => stackItem(s, i, knifePos(i), knives.length - i + 1, "knife"))}
                  </div>
                ) : (
                  <div className="sc-stack sc-stack--empty">
                    <div className="sc-empty-gun">
                      <EmptyGunArt icon={payload.defaultIcons?.["MELEE"]} weaponName="Melee" />
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
                {options.hideName || !payload.gameName ? (
                  <div className="sc-card-user sc-card-user--hidden">Riot ID hidden</div>
                ) : (
                  <div className="sc-card-user">
                    {payload.gameName}
                    {payload.tagLine && <span className="sc-card-tag">#{payload.tagLine}</span>}
                  </div>
                )}
                {payload.accountLevel != null && (
                  <div className="sc-card-level">LV. {payload.accountLevel}</div>
                )}
              </div>
              {checkedCards.length > 1 && <div className="sc-more">+{checkedCards.length - 1} MORE</div>}
            </div>
          )}
          {agent && (
            <div className="sc-agent">
              <span className="sc-agent-art">
                {agent.icon ? <img src={thumb(agent.icon, 128)} alt="" /> : null}
              </span>
              <span className="sc-agent-meta">
                <span className="sc-agent-label">Main agent</span>
                <span className="sc-agent-name">{agent.name}</span>
                {agent.role && <span className="sc-agent-role">{agent.role}</span>}
              </span>
            </div>
          )}
          <dl className="sc-stats">
            <div>
              <dt>SKINS</dt>
              <dd>{checkedSkins.length - knifeCount}</dd>
            </div>
            <div>
              <dt>PREMIUM</dt>
              <dd>{premCount}</dd>
            </div>
            <div>
              <dt>MELEE</dt>
              <dd>{knifeCount}</dd>
            </div>
            <div>
              <dt>BUDDIES</dt>
              <dd>{checkedBuddies.length}</dd>
            </div>
            {(totalVp > 0 || hasExtras) && (
              <div className="sc-stat-value">
                <dt>VALUE</dt>
                {totalVp > 0 && (
                  <dd>
                    {fmt(totalVp)}
                    <small> VP</small>
                    <span className="sc-stat-usd">~${fmt(vpToUsd(totalVp))}</span>
                  </dd>
                )}
                {hasExtras && (
                  <dd className="sc-stat-extras">
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
                    {options.fm && (
                      <span className="sc-chip sc-badge sc-badge--fm" title="First mail">
                        FM:
                        <svg viewBox="0 0 16 16" width="13" height="13" aria-label="yes">
                          <circle cx="8" cy="8" r="8" fill="#ff4655" />
                          <path d="M4.6 8.3l2.2 2.2 4.6-4.8" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </span>
                    )}
                  </dd>
                )}
              </div>
            )}
          </dl>
          <div className="sc-ranks">
            <Medallion label="PEAK" tier={payload.ranks.peak} badge={payload.ranks.peakBadge} />
            <Medallion label="CURRENT" tier={payload.ranks.current} badge={payload.ranks.currentBadge} />
          </div>
        </aside>
      </div>
    </div>
  );
}
