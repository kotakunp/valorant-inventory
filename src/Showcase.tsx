import type { ChromaSelection, ShowcasePayload, Selection, SkinItem, ItemKind } from "./types";
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
  chromaSel?: ChromaSelection;
  footer: { fm: boolean; fmText: string; proof: boolean; proofText: string };
  onToggleSkin?: (id: string) => void;
  onPickChroma?: (skinId: string, chromaId: string) => void;
}

/** Client collection categories (weaponName → group), order = display order. */
export const WEAPON_CATEGORIES = [
  { id: "sidearm", label: "SIDEARMS", weapons: ["Classic", "Shorty", "Frenzy", "Ghost", "Sheriff"] },
  { id: "smg", label: "SMGS", weapons: ["Stinger", "Spectre"] },
  { id: "shotgun", label: "SHOTGUNS", weapons: ["Bucky", "Judge"] },
  { id: "rifle", label: "RIFLES", weapons: ["Bulldog", "Guardian", "Phantom", "Vandal"] },
  { id: "sniper", label: "SNIPER RIFLES", weapons: ["Marshal", "Operator"] },
  { id: "mg", label: "MACHINE GUNS", weapons: ["Ares", "Odin"] },
] as const;

export function categoryFor(weaponName: string): { id: string; label: string } {
  const w = weaponName.trim();
  for (const c of WEAPON_CATEGORIES) {
    if (c.weapons.some((x) => x.toLowerCase() === w.toLowerCase())) {
      return { id: c.id, label: c.label };
    }
  }
  // Loose contains for catalog variants ("Sheriff..." etc.)
  for (const c of WEAPON_CATEGORIES) {
    if (c.weapons.some((x) => w.toLowerCase().includes(x.toLowerCase()))) {
      return { id: c.id, label: c.label };
    }
  }
  return { id: "other", label: "OTHER" };
}

export function groupByCategory(items: SkinItem[]): { id: string; label: string; items: SkinItem[] }[] {
  const order = [...WEAPON_CATEGORIES.map((c) => ({ id: c.id as string, label: c.label as string })), { id: "other", label: "OTHER" }];
  const buckets = new Map<string, SkinItem[]>();
  for (const s of items) {
    const cat = categoryFor(s.weaponName);
    if (!buckets.has(cat.id)) buckets.set(cat.id, []);
    buckets.get(cat.id)!.push(s);
  }
  return order.filter((c) => buckets.get(c.id)?.length).map((c) => ({ ...c, items: buckets.get(c.id)! }));
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

function Medallion({ label, tier }: { label: string; tier: number | null }) {
  const info = tierInfo(tier);
  return (
    <div className="sc-rank-panel">
      <div className="sc-medal-label">
        <span className="sc-rank-caret" aria-hidden="true" />
        {label}
      </div>
      <div className="sc-medal-diamond" style={{ background: info.color }}>
        <div className="sc-medal-inner">
          <span className="sc-medal-name" style={{ color: info.color }}>
            {info.name}
          </span>
        </div>
      </div>
    </div>
  );
}

export function Showcase({ payload, pages, page, selection, chromaSel = {}, footer, onToggleSkin, onPickChroma }: Props) {
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
  const cats = groupByCategory(gridItems);

  const activeChroma = (s: SkinItem) => {
    const id = chromaSel[s.id] ?? s.defaultChromaId ?? s.chromas[0]?.id;
    return s.chromas.find((c) => c.id === id) ?? null;
  };

  const tileIcon = (s: SkinItem) => activeChroma(s)?.icon ?? s.icon;

  const tile = (s: SkinItem) => {
    const chroma = activeChroma(s);
    const showPicker = !!onPickChroma && s.chromas.length > 1;
    const rarity = rarityColor(s.price);
    return (
      <div
        key={s.id}
        className={`sc-tile${s.equipped ? " equipped" : ""}`}
        style={{ borderColor: rarity, ["--rarity" as string]: rarity }}
        onClick={onToggleSkin ? () => onToggleSkin(s.id) : undefined}
        title={s.name}
      >
        <span className="sc-tile-gem" style={{ background: rarity, boxShadow: `0 0 8px ${rarity}` }} />
        {s.equipped && <span className="sc-check">✓</span>}
        <div className="sc-tile-art">
          {tileIcon(s) ? (
            <img src={imgUrl(tileIcon(s))!} alt="" />
          ) : (
            <span className="sc-fallback">{s.weaponName}</span>
          )}
        </div>
        <div className="sc-tile-name">{s.name}</div>
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

  return (
    <div className="sc-root">
      <div className="sc-wedge" />
      <header className="sc-header">
        <VLogo />
        <span className="sc-header-div" aria-hidden="true" />
        <div className="sc-title">COLLECTION</div>
        <div className="sc-header-rule" aria-hidden="true" />
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
          <Medallion label="CURRENT RANK" tier={payload.ranks.current} />
          {(payload.wallet.vp != null || payload.wallet.rp != null) && (
            <div className="sc-wallet">
              {payload.wallet.vp != null && <span className="sc-chip">◆ {fmt(payload.wallet.vp)} VP</span>}
              {payload.wallet.rp != null && <span className="sc-chip">✦ {fmt(payload.wallet.rp)} RP</span>}
            </div>
          )}
        </aside>

        <main className={`sc-center density-${pages.density.name}`}>
          <div className="sc-cats">
            {cats.map((cat) => (
              <section className="sc-cat" key={cat.id}>
                <div className="sc-cat-head">
                  <CatMark />
                  <span className="sc-cat-name">{cat.label}</span>
                  <span className="sc-cat-rule" aria-hidden="true" />
                </div>
                <div className="sc-cat-tiles">{cat.items.map(tile)}</div>
              </section>
            ))}
            {cats.length === 0 && gridItems.length === 0 && (
              <div className="sc-empty">
                {pages.totalSelected === 0 ? "NO SKINS SELECTED" : pageCount > 1 ? "SEE PAGE 1" : "NO SKINS"}
              </div>
            )}
          </div>

          {page === 0 && pages.knifeRow.length > 0 && (
            <div className="sc-knives">
              <div className="sc-cat-head">
                <CatMark />
                <span className="sc-cat-name">KNIVES</span>
                <span className="sc-cat-rule" aria-hidden="true" />
              </div>
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
