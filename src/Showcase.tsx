import type { ChromaSelection, RankBadge, ShowcasePayload, Selection, SkinItem, ItemKind } from "./types";
import { selKey } from "./types";
import type { Pages } from "./logic";
import { rarityColor, tierInfo, collectionValue, groupByGun, isPremiumSkin } from "./logic";

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
  footer: { fm: boolean; fmText: string; proof: boolean; proofText: string };
  onToggleSkin?: (id: string) => void;
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

export function Showcase({ payload, pages, page, selection, chromaSel = {}, footer, onToggleSkin, onPickChroma }: Props) {
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
  const value = collectionValue(payload, selection);
  const pageCount = pages.gridPages.length;
  const gridItems = pages.gridPages[page] ?? [];
  const knifeItems = pages.knifeItems ?? [];
  const date = payload.generatedAt.slice(0, 10);
  const guns = groupByGun(gridItems);
  const knives = groupByGun(knifeItems);

  const activeChroma = (s: SkinItem) => {
    const id = chromaSel[s.id] ?? s.defaultChromaId ?? s.chromas[0]?.id;
    return s.chromas.find((c) => c.id === id) ?? null;
  };

  const tileIcon = (s: SkinItem) => activeChroma(s)?.icon ?? s.icon;

  /** One layered skin inside a gun stack — hover raises it via CSS z-index. */
  const stackItem = (s: SkinItem, index: number) => {
    const chroma = activeChroma(s);
    const showPicker = !!onPickChroma && s.chromas.length > 1;
    const rarity = rarityColor(s.price, s.levelCount, s.contentTierRank ?? null);
    return (
      <div
        key={s.id}
        className={`sc-stack-item${s.equipped ? " equipped" : ""}${onToggleSkin ? " clickable" : ""}`}
        style={{ zIndex: index + 1, ["--rarity" as string]: rarity }}
        onClick={onToggleSkin ? () => onToggleSkin(s.id) : undefined}
        title={s.name}
      >
        <span className="sc-tile-gem" style={{ background: rarity, boxShadow: `0 0 8px ${rarity}` }} />
        {s.equipped && <span className="sc-check">✓</span>}
        {tileIcon(s) ? (
          <img className="sc-stack-art" src={imgUrl(tileIcon(s))!} alt="" />
        ) : (
          <span className="sc-fallback">{s.weaponName}</span>
        )}
        <span className="sc-stack-name">{s.name}</span>
        {showPicker && (
          <div
            className="sc-chromas"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
            role="group"
            aria-label={`Chroma for ${s.name}`}
          >
            {s.chromas.map((c) => (
              <button
                key={c.id}
                type="button"
                className={"sc-chroma" + (chroma?.id === c.id ? " on" : "")}
                title={c.name}
                onClick={(e) => {
                  e.stopPropagation();
                  onPickChroma!(s.id, c.id);
                }}
              >
                {c.icon ? <img src={imgUrl(c.icon)!} alt="" /> : <span>{c.name.slice(0, 1)}</span>}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  };

  const gunSection = (gun: { id: string; label: string; items: SkinItem[] }) => (
    <section className="sc-cat" key={gun.id}>
      <div className="sc-cat-head">
        <CatMark />
        <span className="sc-cat-name">{gun.label}</span>
        <span className="sc-cat-rule" aria-hidden="true" />
        {gun.items.length > 1 && <span className="sc-stack-count">{gun.items.length}</span>}
      </div>
      <div className="sc-stack">{gun.items.map((s, i) => stackItem(s, i))}</div>
    </section>
  );

  return (
    <div className="sc-root">
      <div className="sc-wedge" />
      <header className="sc-header">
        <VLogo />
        <span className="sc-header-div" aria-hidden="true" />
        <div className="sc-title">COLLECTION</div>
        <div className="sc-header-rule" aria-hidden="true" />
        {payload.accountLevel != null && <span className="sc-badge">LV. {payload.accountLevel}</span>}
        <span className="sc-badge sc-badge--region">{payload.region.toUpperCase()}</span>
      </header>

      <div className="sc-body">
        <aside className="sc-left">
          <Medallion label="PEAK RANK" tier={payload.ranks.peak} badge={payload.ranks.peakBadge} />
          <Medallion label="CURRENT RANK" tier={payload.ranks.current} badge={payload.ranks.currentBadge} />
          {(payload.wallet.vp != null || payload.wallet.rp != null) && (
            <div className="sc-wallet">
              {payload.wallet.vp != null && <span className="sc-chip">◆ {fmt(payload.wallet.vp)} VP</span>}
              {payload.wallet.rp != null && <span className="sc-chip">✦ {fmt(payload.wallet.rp)} RP</span>}
            </div>
          )}
        </aside>

        <main className={`sc-center density-${pages.density.name}`}>
          <div className="sc-cats">
            {guns.map(gunSection)}
            {guns.length === 0 && gridItems.length === 0 && knifeItems.length === 0 && (
              <div className="sc-empty">
                {pages.totalSelected === 0 ? "NO SKINS SELECTED" : pageCount > 1 ? "SEE PAGE 1" : "NO SKINS"}
              </div>
            )}
          </div>
          {knifeItems.length > 0 && (
            <div className="sc-knife-row">
              <div className="sc-cat-head sc-cat-head--sm">
                <KnifeIcon />
                <span className="sc-cat-name">MELEE</span>
                <span className="sc-cat-rule" aria-hidden="true" />
                <span className="sc-stack-count">{knifeItems.length}</span>
              </div>
              <div className="sc-knife-strip">
                {knives.flatMap((g) => g.items).map((s) => (
                  <div className="sc-knife-cell" key={s.id}>
                    {stackItem(s, 0)}
                  </div>
                ))}
              </div>
            </div>
          )}
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

      <footer className="sc-footer">
        <div className="sc-stats">
          <div className="sc-stat">
            <CrownIcon />
            <span className="sc-stat-label">PREMIUM SKINS</span>
            <span className="sc-stat-val">{premCount}</span>
          </div>
          <div className="sc-stat-div" aria-hidden="true" />
          <div className="sc-stat">
            <KnifeIcon />
            <span className="sc-stat-label">KNIFE SKINS</span>
            <span className="sc-stat-val">{knifeCount}</span>
          </div>
        </div>
        <div className="sc-footer-meta">
          <span>COLLECTION: {fmt(value)} VP</span>
          {footer.fm && footer.fmText && <span>FM: {footer.fmText}</span>}
          {footer.proof && footer.proofText && <span>PROOF: {footer.proofText}</span>}
          <span>
            {date}
            {pageCount > 1 && ` · ${page + 1}/${pageCount}`}
          </span>
        </div>
      </footer>
    </div>
  );
}
