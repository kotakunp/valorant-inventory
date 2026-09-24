import { useEffect, useState } from "react";
import type { ChromaSelection, RankBadge, ShowcasePayload, Selection, SkinItem, ItemKind } from "./types";
import { selKey } from "./types";
import type { GunGroup, Pages } from "./logic";
import { WEAPON_CATEGORIES, LOADOUT_GUNS, rarityColor, tierInfo, isPremiumSkin } from "./logic";

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

function CrownIcon() {
  return (
    <svg viewBox="0 0 20 16" width="18" height="14" aria-hidden="true">
      <path d="M2 13 L1 4 L6 8 L10 2 L14 8 L19 4 L18 13 Z" fill="#ff4655" />
      <rect x="2" y="13" width="16" height="2" fill="#ff4655" />
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

/** Official currency display icons (valorant-api.com currencies) */
const VP_ICON =
  "https://media.valorant-api.com/currencies/85ad13f7-3d1b-5128-9eb2-7cd8ee0b5741/displayicon.png";
const RP_ICON =
  "https://media.valorant-api.com/currencies/e59aa87c-4cbf-517a-5983-6e81511be9b7/displayicon.png";

function CurrencyIcon({ src, alt }: { src: string; alt: string }) {
  return <img className="sc-wallet-icon" src={imgUrl(src) ?? undefined} alt={alt} />;
}

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
}: Props) {
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const interactive = !!onRemoveSkin;

  useEffect(() => {
    if (!openMenu) return;
    const close = () => setOpenMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [openMenu]);

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

  /** Exactly 4 category columns (+ OTHER for unknown guns). */
  const catColumns: { id: string; label: string; guns: GunGroup[] }[] = (() => {
    const official = new Set(LOADOUT_GUNS.map((w) => w.toUpperCase()));
    const used = new Set<string>();
    const cols: { id: string; label: string; guns: GunGroup[] }[] = WEAPON_CATEGORIES.map((cat) => {
      const ids = cat.guns.map((w) => w.toUpperCase());
      const guns = slots.filter((g) => {
        if (used.has(g.id) || !ids.includes(g.id)) return false;
        used.add(g.id);
        return true;
      });
      return { id: cat.id, label: cat.label, guns };
    });
    const other = slots.filter((g) => {
      if (used.has(g.id) || official.has(g.id)) return false;
      used.add(g.id);
      return true;
    });
    if (other.length) cols.push({ id: "other", label: "OTHER", guns: other });
    return cols;
  })();

  const activeChroma = (s: SkinItem) => {
    const id = chromaSel[s.id] ?? s.defaultChromaId ?? s.chromas[0]?.id;
    return s.chromas.find((c) => c.id === id) ?? null;
  };

  const tileIcon = (s: SkinItem) => activeChroma(s)?.icon ?? s.icon;

  /** One layered skin — click opens the context menu (not a selection toggle). */
  const stackItem = (s: SkinItem, index: number, gunId: string) => {
    const chroma = activeChroma(s);
    const menuOpen = interactive && openMenu === s.id;
    const rarity = rarityColor(s.price, s.levelCount, s.contentTierRank ?? null);
    return (
      <div
        key={s.id}
        className={`sc-stack-item${s.equipped ? " equipped" : ""}${interactive ? " clickable" : ""}${menuOpen ? " menu-open" : ""}`}
        style={{ zIndex: menuOpen ? 80 : index + 1, ["--rarity" as string]: rarity }}
        onClick={
          interactive
            ? (e) => {
                e.stopPropagation();
                setOpenMenu((cur) => (cur === s.id ? null : s.id));
              }
            : undefined
        }
        title={s.name}
      >
        {s.equipped && <span className="sc-check">✓</span>}
        {tileIcon(s) ? (
          <span className="sc-stack-frame">
            <img className="sc-stack-art" src={imgUrl(tileIcon(s))!} alt="" />
          </span>
        ) : (
          <span className="sc-fallback">{s.weaponName}</span>
        )}
        {menuOpen && (
          <div
            className="sc-skin-menu"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
            role="menu"
            aria-label={`Options for ${s.name}`}
          >
            {s.chromas.length > 1 && onPickChroma && (
              <div className="sc-skin-menu-row sc-chromas sc-chromas--menu">
                {s.chromas.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className={"sc-chroma" + (chroma?.id === c.id ? " on" : "")}
                    title={c.name}
                    onClick={(e) => {
                      e.stopPropagation();
                      onPickChroma(s.id, c.id);
                    }}
                  >
                    {c.icon ? <img src={imgUrl(c.icon)!} alt="" /> : <span>{c.name.slice(0, 1)}</span>}
                  </button>
                ))}
              </div>
            )}
            {onBringToFront && (
              <button
                type="button"
                className="sc-skin-menu-btn"
                onClick={() => {
                  onBringToFront(gunId, s.id);
                  setOpenMenu(null);
                }}
              >
                Show in front
              </button>
            )}
            {onRemoveSkin && (
              <button
                type="button"
                className="sc-skin-menu-btn sc-skin-menu-btn--danger"
                onClick={() => {
                  onRemoveSkin(s.id);
                  setOpenMenu(null);
                }}
              >
                Remove
              </button>
            )}
          </div>
        )}
      </div>
    );
  };

  const orderStack = (gun: GunGroup): SkinItem[] => {
    const front = bringToFront[gun.id];
    if (!front) return gun.items;
    const rest = gun.items.filter((s) => s.id !== front);
    const f = gun.items.find((s) => s.id === front);
    return f ? [...rest, f] : gun.items;
  };

  const gunSection = (gun: GunGroup) => {
    const items = orderStack(gun);
    const empty = items.length === 0;
    return (
      <section className={`sc-cat${empty ? " sc-cat--empty" : ""}`} key={gun.id}>
        <div className="sc-cat-head">
          <CatMark />
          <span className="sc-cat-name">{gun.label}</span>
          <span className="sc-cat-rule" aria-hidden="true" />
          {!empty && items.length > 1 && <span className="sc-stack-count">{items.length}</span>}
        </div>
        <div
          className={`sc-stack${items.length > 1 ? " is-stacked" : ""}${empty ? " sc-stack--empty" : ""}`}
          style={{ ["--n" as string]: Math.max(items.length, 1) }}
        >
          {empty ? <div className="sc-empty-gun" aria-hidden="true" /> : items.map((s, i) => stackItem(s, i, gun.id))}
        </div>
      </section>
    );
  };

  return (
    <div className="sc-root">
      <div className="sc-wedge" />
      <header className="sc-header">
        <VLogo />
        <span className="sc-header-div" aria-hidden="true" />
        <div className="sc-title">COLLECTION</div>
        <div className="sc-header-rule" aria-hidden="true" />
      </header>

      <div className="sc-body">
        <main className={`sc-center density-${pages.density.name}`}>
          <div className="sc-cats">
            {catColumns.map((col) => (
              <div className="sc-cat-col" key={col.id}>
                <div className="sc-cat-col-head">
                  <span className="sc-cat-col-label">{col.label}</span>
                  <span className="sc-cat-col-rule" aria-hidden="true" />
                </div>
                {col.guns.map(gunSection)}
              </div>
            ))}
            {catColumns.length === 0 && (
              <div className="sc-empty">
                {pages.totalSelected === 0 ? "NO SKINS SELECTED" : pageCount > 1 ? "SEE PAGE 1" : "NO SKINS"}
              </div>
            )}
          </div>
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
                    <div className="sc-stack" style={{ ["--n" as string]: 1 }}>
                      {stackItem(s, 0, "MELEE")}
                    </div>
                  </div>
                ))
              ) : (
                <div className="sc-knife-cell sc-knife-cell--empty">
                  <div className="sc-stack sc-stack--empty">
                    <div className="sc-empty-gun" aria-hidden="true" />
                  </div>
                </div>
              )}
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
          <div className="sc-rail-info">
            <div className="sc-ranks">
              <Medallion label="PEAK" tier={payload.ranks.peak} badge={payload.ranks.peakBadge} />
              <Medallion label="CURRENT" tier={payload.ranks.current} badge={payload.ranks.currentBadge} />
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
            <div className="sc-stats">
              <div className="sc-stat">
                <CrownIcon />
                <span className="sc-stat-label">PREMIUM</span>
                <span className="sc-stat-val">{premCount}</span>
              </div>
              <div className="sc-stat-div" aria-hidden="true" />
              <div className="sc-stat">
                <KnifeIcon />
                <span className="sc-stat-label">KNIFE</span>
                <span className="sc-stat-val">{knifeCount}</span>
              </div>
            </div>
          </div>
          {checkedBuddies.length > 0 && (
            <div className="sc-buddies">
              <div className="sc-cat-head sc-cat-head--sm">
                <span className="sc-cat-name">BUDDIES</span>
                <span className="sc-cat-rule" aria-hidden="true" />
              </div>
              <div className="sc-buddy-row">
                {checkedBuddies.slice(0, 6).map((b) =>
                  b.icon ? <img key={b.id} src={imgUrl(b.icon)!} alt="" /> : null
                )}
                {checkedBuddies.length > 6 && <span className="sc-more">+{checkedBuddies.length - 6}</span>}
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
