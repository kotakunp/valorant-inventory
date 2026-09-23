import type { ShowcasePayload, Selection, SkinItem, ItemKind } from "./types";
import { selKey } from "./types";
import type { Pages } from "./logic";
import { rarityColor, tierInfo, collectionValue } from "./logic";

export const CANVAS_W = 1280;
export const CANVAS_H = 720;

const imgUrl = (u: string | null) => (u ? `/img/${encodeURIComponent(u)}` : null);
const fmt = (n: number) => n.toLocaleString("en-US");

interface Props {
  payload: ShowcasePayload;
  pages: Pages;
  page: number;
  selection: Selection;
  footer: { fm: boolean; fmText: string; proof: boolean; proofText: string };
  onToggleSkin?: (id: string) => void;
}

function Medallion({ label, tier }: { label: string; tier: number | null }) {
  const info = tierInfo(tier);
  return (
    <div className="sc-medal">
      <div className="sc-medal-label">{label}</div>
      <div className="sc-medal-ring" style={{ borderColor: info.color, boxShadow: `0 0 16px ${info.color}55, inset 0 0 12px ${info.color}22` }}>
        <span className="sc-medal-name" style={{ color: info.color }}>{info.name}</span>
      </div>
    </div>
  );
}

export function Showcase({ payload, pages, page, selection, footer, onToggleSkin }: Props) {
  const isOn = (kind: ItemKind, id: string) => !!selection[selKey(kind, id)];
  const checkedSkins = payload.skins.filter((s) => isOn("skin", s.id));
  const premCount = checkedSkins.filter((s) => !s.isKnife && (s.price ?? 0) >= 1775).length;
  const knifeCount = checkedSkins.filter((s) => s.isKnife).length;
  const checkedCards = payload.cards.filter((c) => isOn("card", c.id));
  const checkedTitles = payload.titles.filter((t) => isOn("title", t.id));
  const checkedBuddies = payload.buddies.filter((b) => isOn("buddy", b.id));
  const card = checkedCards.find((c) => c.equipped) ?? checkedCards[0];
  const title = checkedTitles.find((t) => t.equipped) ?? checkedTitles[0];
  const value = collectionValue(payload, selection);
  const pageCount = pages.gridPages.length;
  const gridItems = pages.gridPages[page] ?? [];
  const date = payload.generatedAt.slice(0, 10);

  const tile = (s: SkinItem) => (
    <div
      key={s.id}
      className={`sc-tile${s.equipped ? " equipped" : ""}`}
      style={{ borderColor: rarityColor(s.price) }}
      onClick={onToggleSkin ? () => onToggleSkin(s.id) : undefined}
      title={s.name}
    >
      {s.equipped && <span className="sc-check">✓</span>}
      {s.icon ? <img src={imgUrl(s.icon)!} alt="" /> : <span className="sc-fallback">{s.weaponName}</span>}
      <div className="sc-tile-foot">
        <span className="sc-tile-name">{s.name}</span>
        {s.variantCount > 1 && <span className="sc-tile-tag">×{s.variantCount}</span>}
      </div>
    </div>
  );

  return (
    <div className="sc-root">
      <div className="sc-wedge" />
      <header className="sc-header">
        <div className="sc-name">
          {payload.gameName}
          {payload.tagLine && <span className="sc-tag">#{payload.tagLine}</span>}
        </div>
        {payload.accountLevel != null && <span className="sc-badge">LV. {payload.accountLevel}</span>}
        <span className="sc-badge sc-badge--region">{payload.region.toUpperCase()}</span>
        {title && <span className="sc-header-title">“{title.text}”</span>}
      </header>

      <div className="sc-body">
        <aside className="sc-left">
          <Medallion label="PEAK RANK" tier={payload.ranks.peak} />
          <Medallion label="CURR RANK" tier={payload.ranks.current} />
          {(payload.wallet.vp != null || payload.wallet.rp != null) && (
            <div className="sc-wallet">
              {payload.wallet.vp != null && <span className="sc-chip">◆ {fmt(payload.wallet.vp)} VP</span>}
              {payload.wallet.rp != null && <span className="sc-chip">✦ {fmt(payload.wallet.rp)} RP</span>}
            </div>
          )}
        </aside>

        <main className={`sc-center density-${pages.density.name}`}>
          <div className="sc-section-label">
            COLLECTION
            {pageCount > 1 && <span className="sc-page-ind">{page + 1}/{pageCount}</span>}
          </div>
          {gridItems.length > 0 ? (
            <div className="sc-grid" style={{ gridTemplateColumns: `repeat(${pages.density.cols}, 1fr)` }}>
              {gridItems.map(tile)}
            </div>
          ) : (
            <div className="sc-empty">{pages.totalSelected === 0 ? "NO SKINS SELECTED" : "SEE PAGE 1"}</div>
          )}
          {page === 0 && pages.knifeRow.length > 0 && (
            <div className="sc-knives">
              <div className="sc-section-label">KNIVES</div>
              <div className="sc-knife-row">{pages.knifeRow.map(tile)}</div>
            </div>
          )}
        </main>

        <aside className="sc-right">
          {card && (
            <div className="sc-card-panel">
              {card.icon ? <img src={imgUrl(card.icon)!} alt="" /> : <div className="sc-fallback">{card.name}</div>}
              <div className="sc-card-label">PLAYER CARD</div>
              {checkedCards.length > 1 && <div className="sc-more">+{checkedCards.length - 1} MORE</div>}
            </div>
          )}
          {checkedBuddies.length > 0 && (
            <div className="sc-buddies">
              <div className="sc-section-label">BUDDIES</div>
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
        <span>PREM: {premCount}</span>
        <span>KNIFE: {knifeCount}</span>
        <span>COLLECTION: {fmt(value)} VP</span>
        {footer.fm && footer.fmText && <span>FM: {footer.fmText}</span>}
        {footer.proof && footer.proofText && <span>PROOF: {footer.proofText}</span>}
        <span className="sc-footer-right">
          {date}
          {pageCount > 1 && ` · ${page + 1}/${pageCount}`}
        </span>
      </footer>
    </div>
  );
}

