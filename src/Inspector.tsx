import { useState } from "react";
import { createPortal } from "react-dom";
import type { ChromaSelection, ItemKind, Selection, ShowcasePayload, SkinItem } from "./types";
import { selKey } from "./types";
import type { Pages } from "./logic";
import { collectionValue, favoriteAgent, isPremiumSkin, vpToUsd } from "./logic";
import type { LibraryTab } from "./Library";
import { SkinArt } from "./skinArt";
import { IconCheck, IconCopy, IconDownload, IconLink } from "./icons";
import { thumb } from "./thumb";

const img = (u: string | null | undefined) => (u ? `/img/${encodeURIComponent(u)}` : undefined);
const fmt = (n: number) => n.toLocaleString("en-US");

const PEEK_W = 340;
const PEEK_H = 236;

export type ShareUi =
  | { phase: "idle" }
  | { phase: "working"; label: string }
  | { phase: "ready"; url: string; expiresAt: string; copied: boolean; stale: boolean }
  | { phase: "error"; message: string };

const expiryFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

function SharePanel({ share, onShare }: { share: ShareUi; onShare: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = (url: string) =>
    void navigator.clipboard?.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });

  if (share.phase !== "ready") {
    return (
      <div className="insp-share">
        <button className="btn btn-secondary btn-block" onClick={onShare} disabled={share.phase === "working"}>
          {share.phase !== "working" && <IconLink />}
          {share.phase === "working" ? share.label : "Create share link"}
        </button>
        {share.phase === "error" && (
          <p className="share-msg share-msg--error" role="alert">
            {share.message}
          </p>
        )}
      </div>
    );
  }

  const justCopied = copied || share.copied;
  return (
    <div className="insp-share">
      <div className={`share-url${share.stale ? " is-stale" : ""}`}>
        <input readOnly value={share.url} aria-label="Share link" onFocus={(e) => e.currentTarget.select()} />
        <button
          type="button"
          className="icon-btn"
          onClick={() => copy(share.url)}
          title={justCopied ? "Copied" : "Copy link"}
          aria-label={justCopied ? "Copied" : "Copy link"}
        >
          {justCopied ? <IconCheck /> : <IconCopy />}
        </button>
      </div>
      {share.stale ? (
        <div className="share-msg share-msg--stale">
          <span>Your selection changed. This link still shows the earlier version.</span>
          <button type="button" className="btn-sm" onClick={onShare}>
            New link
          </button>
        </div>
      ) : (
        <p className="share-msg">
          {share.copied ? "Link copied. " : ""}Anyone with the link can view · expires {expiryFmt.format(new Date(share.expiresAt))}
        </p>
      )}
    </div>
  );
}

type VariantHover = { skin: SkinItem; chromaId: string; rect: DOMRect };

/** "Odin Level 4 (Variant 2 Blue)" -> "Level 4 (Variant 2 Blue)"; "Odin (Red)" -> "Red". */
function chromaLabel(skinName: string, chromaName: string): string {
  let s = chromaName.replace(skinName, "").replace(/^[\s\-–:]+/, "").trim();
  if (/^\([^()]*\)$/.test(s)) s = s.slice(1, -1).trim();
  return s || chromaName;
}

/** Enlarged variant art beside the inspector; display-only, so it never takes the pointer. */
function VariantPeek({ hover, activeId }: { hover: VariantHover; activeId: string | undefined }) {
  const { skin, chromaId, rect } = hover;
  const index = Math.max(0, skin.chromas.findIndex((c) => c.id === chromaId));
  const chroma = skin.chromas[index];
  const icon = chroma?.icon ?? skin.icon;
  const left = Math.max(12, rect.left - PEEK_W - 14);
  const top = Math.max(12, Math.min(rect.top + rect.height / 2 - PEEK_H / 2, window.innerHeight - PEEK_H - 12));
  return createPortal(
    <aside className="variant-peek" style={{ left, top, width: PEEK_W }} aria-hidden="true">
      <div className="variant-peek-art">
        {icon && <SkinArt src={img(icon)!} alt="" weaponName={skin.weaponName} isKnife={skin.isKnife} />}
      </div>
      <div className="variant-peek-bar">
        <div className="variant-peek-text">
          <span className="variant-peek-skin">{skin.name}</span>
          <span className="variant-peek-chroma">{index === 0 ? "Base" : chroma ? chromaLabel(skin.name, chroma.name) : ""}</span>
        </div>
        <span className="variant-peek-state">
          {chromaId === activeId ? "Shown" : "Click to show"}
          <small>
            {index + 1} / {skin.chromas.length}
          </small>
        </span>
      </div>
    </aside>,
    document.fullscreenElement ?? document.body
  );
}

interface Props {
  data: ShowcasePayload;
  pages: Pages;
  page: number;
  onPage: (page: number) => void;
  selection: Selection;
  chromaSel: ChromaSelection;
  exportPhase: string | null;
  exporting: boolean;
  onExport: () => void;
  onPreset: (mode: "all" | "none" | "premium") => void;
  onPickChroma: (skinId: string, chromaId: string) => void;
  onOpenTab: (tab: LibraryTab) => void;
  /** null when this server has no share storage. */
  share: ShareUi | null;
  onShare: () => void;
}

export function Inspector({
  data,
  pages,
  page,
  onPage,
  selection,
  chromaSel,
  exportPhase,
  exporting,
  onExport,
  onPreset,
  onPickChroma,
  onOpenTab,
  share,
  onShare,
}: Props) {
  const isOn = (kind: ItemKind, id: string) => !!selection[selKey(kind, id)];
  const skins = data.skins.filter((s) => isOn("skin", s.id));
  const premium = skins.filter((s) => isPremiumSkin(s)).length;
  const knives = skins.filter((s) => s.isKnife).length;
  const buddies = data.buddies.filter((b) => isOn("buddy", b.id)).length;
  const card = data.cards.find((c) => isOn("card", c.id));
  const title = data.titles.find((t) => isOn("title", t.id));
  const agent = (data.agents ?? []).find((a) => isOn("agent", a.id));
  const favAgent = favoriteAgent(data);
  const vp = collectionValue(data, selection);
  const pageCount = pages.gridPages.length;
  const withChromas = skins.filter((s): s is SkinItem => s.chromas.length > 1);
  const [hover, setHover] = useState<VariantHover | null>(null);

  return (
    <aside className="pane pane--inspector" aria-label="Showcase settings">
      <div className="insp-export">
        <button className="btn btn-primary btn-block btn-lg" onClick={onExport} disabled={exporting}>
          {!exporting && <IconDownload />}
          {exportPhase ?? (pageCount > 1 ? `Download ${pageCount} images` : "Download image")}
        </button>
        <div className="insp-export-meta">
          <span>PNG · 2560 × 1440{pageCount > 1 ? ` · ${pageCount} pages` : ""}</span>
          {pageCount > 1 && (
            <span className="pager" aria-label="Preview page">
              <button type="button" onClick={() => onPage(Math.max(0, page - 1))} disabled={page === 0} aria-label="Previous page">‹</button>
              <span>
                {page + 1} / {pageCount}
              </span>
              <button type="button" onClick={() => onPage(Math.min(pageCount - 1, page + 1))} disabled={page >= pageCount - 1} aria-label="Next page">›</button>
            </span>
          )}
        </div>
        {share && <SharePanel share={share} onShare={onShare} />}
      </div>

      <div className="pane-scroll insp-body">
        <section className="insp-section">
          <h3 className="insp-head">Summary</h3>
          <div className="insp-value">
            <span className="insp-value-label">Collection value</span>
            <span className="insp-value-num">
              {vp > 0 ? (
                <>
                  {fmt(vp)}
                  <small>VP</small>
                </>
              ) : (
                "—"
              )}
            </span>
            {vp > 0 && <span className="insp-usd">≈ ${fmt(vpToUsd(vp))} USD</span>}
          </div>
          <dl className="insp-stats">
            <div className="insp-stat">
              <dt>Skins</dt>
              <dd>
                {skins.length}
                <small>/{data.skins.length}</small>
              </dd>
            </div>
            <div className="insp-stat">
              <dt>Premium</dt>
              <dd>{premium}</dd>
            </div>
            <div className="insp-stat">
              <dt>Melee</dt>
              <dd>{knives}</dd>
            </div>
            <div className="insp-stat">
              <dt>Buddies</dt>
              <dd>{buddies}</dd>
            </div>
          </dl>
          {pages.truncated > 0 && (
            <p className="insp-note insp-warn">{pages.truncated} selected skins don&apos;t fit and are left out.</p>
          )}
        </section>

        <section className="insp-section">
          <h3 className="insp-head">Quick select</h3>
          <div className="insp-presets">
            <button type="button" className="btn-sm" onClick={() => onPreset("premium")}>Premium+</button>
            <button type="button" className="btn-sm" onClick={() => onPreset("all")}>Everything</button>
            <button type="button" className="btn-sm" onClick={() => onPreset("none")}>Clear</button>
          </div>
          <p className="insp-note">
            Premium+ and equipped items were picked for you.
            {agent && favAgent && agent.id === favAgent.id && " Your most-played agent was picked for you."}
            {!data.pricesAvailable && " Prices are unavailable, so premium is estimated from skin levels."}
          </p>
        </section>

        <section className="insp-section">
          <h3 className="insp-head">Profile</h3>
          <button type="button" className="insp-profile" onClick={() => onOpenTab("card")}>
            <span className="insp-profile-art">
              {card?.avatar || card?.icon ? <img src={img(card.avatar ?? card.icon)} alt="" /> : <span className="insp-profile-empty" />}
            </span>
            <span className="insp-profile-text">
              <span className="insp-profile-label">Card</span>
              <span className="insp-profile-value">{card?.name ?? "None"}</span>
            </span>
            <span className="insp-change">Change</span>
          </button>
          <button type="button" className="insp-profile" onClick={() => onOpenTab("title")}>
            <span className="insp-profile-text">
              <span className="insp-profile-label">Title</span>
              <span className="insp-profile-value">{title ? title.text || title.name : "None"}</span>
            </span>
            <span className="insp-change">Change</span>
          </button>
          <button type="button" className="insp-profile" onClick={() => onOpenTab("agent")}>
            <span className="insp-profile-art">
              {agent?.icon ? <img src={thumb(agent.icon, 128)} alt="" /> : <span className="insp-profile-empty" />}
            </span>
            <span className="insp-profile-text">
              <span className="insp-profile-label">Agent</span>
              <span className="insp-profile-value">{agent ? agent.name : "None"}</span>
            </span>
            <span className="insp-change">Change</span>
          </button>
        </section>

        {withChromas.length > 0 && (
          <section className="insp-section">
            <h3 className="insp-head">
              Variants <span className="insp-head-count">{withChromas.length}</span>
            </h3>
            <ul className="insp-variants" onPointerLeave={() => setHover(null)}>
              {withChromas.map((s) => {
                const active = chromaSel[s.id] ?? s.defaultChromaId ?? s.chromas[0]?.id;
                const activeChroma = s.chromas.find((c) => c.id === active) ?? s.chromas[0];
                const rowEl = (el: HTMLElement) => (el.closest(".insp-variant") as HTMLElement | null) ?? el;
                const show = (el: HTMLElement, chromaId: string) =>
                  setHover({ skin: s, chromaId, rect: rowEl(el).getBoundingClientRect() });
                return (
                  <li
                    key={s.id}
                    className={`insp-variant${hover?.skin.id === s.id ? " is-hover" : ""}`}
                    onPointerEnter={(e) => active && show(e.currentTarget, active)}
                  >
                    <span className="insp-variant-thumb">
                      {(activeChroma?.icon ?? s.icon) && (
                        <SkinArt src={img(activeChroma?.icon ?? s.icon)!} alt="" loading="lazy" weaponName={s.weaponName} isKnife={s.isKnife} />
                      )}
                    </span>
                    <span className="insp-variant-name" title={s.name}>
                      {s.name}
                    </span>
                    <span className="chroma-dots" role="group" aria-label={`${s.name} variants`}>
                      {s.chromas.map((c, i) => (
                        <button
                          key={c.id}
                          type="button"
                          className={"chroma-dot" + (active === c.id ? " on" : "") + (hover?.skin.id === s.id && hover.chromaId === c.id ? " is-hover" : "")}
                          aria-label={c.name}
                          aria-pressed={active === c.id}
                          onPointerEnter={(e) => show(e.currentTarget, c.id)}
                          onFocus={(e) => show(e.currentTarget, c.id)}
                          onBlur={() => setHover(null)}
                          onClick={() => onPickChroma(s.id, c.id)}
                        >
                          {c.icon ? <img src={img(c.icon)} alt="" loading="lazy" /> : i + 1}
                        </button>
                      ))}
                    </span>
                  </li>
                );
              })}
            </ul>
            {hover && (
              <VariantPeek
                hover={hover}
                activeId={chromaSel[hover.skin.id] ?? hover.skin.defaultChromaId ?? hover.skin.chromas[0]?.id}
              />
            )}
          </section>
        )}
      </div>
    </aside>
  );
}
