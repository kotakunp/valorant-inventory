import { useMemo, useState, useEffect, useRef } from "react";
import { toJpeg, toPng } from "html-to-image";
import type { ChromaSelection, ItemKind, Selection, SharePicks, ShowcasePayload, SkinItem } from "./types";
import { isSingleSlot, selKey } from "./types";
import { buildSelection, isPremiumSkin, paginate, pickSingleSlot } from "./logic";
import type { AnyItem } from "./logic";
import { Showcase, CANVAS_W, CANVAS_H } from "./Showcase";
import { StorePanel } from "./StorePanel";
import { ProfilePanel } from "./ProfilePanel";
import { SignIn } from "./SignIn";
import { Library, type LibraryTab } from "./Library";
import { Inspector, type ShareUi } from "./Inspector";
import { useFitScale } from "./useFitScale";
import { IconExpand, IconFit, IconProfile, IconShowcase, IconStore, IconSwitch } from "./icons";

const fmt = (n: number) => n.toLocaleString("en-US");
const img = (u: string) => `/img/${encodeURIComponent(u)}`;

const VP_ICON =
  "https://media.valorant-api.com/currencies/85ad13f7-3d1b-5128-9eb2-7cd8ee0b5741/displayicon.png";
const RP_ICON =
  "https://media.valorant-api.com/currencies/e59aa87c-4cbf-517a-5983-6e81511be9b7/displayicon.png";

type View = "showcase" | "store" | "profile";

/**
 * Wait for every image matching `selector`; resolves with the sources that failed.
 * Bounded: an image stuck in neither `load` nor `error` would otherwise hang
 * the caller with no way out but a reload.
 */
async function waitForImages(selector: string): Promise<string[]> {
  const imgs = Array.from(document.querySelectorAll<HTMLImageElement>(selector));
  const failed: string[] = [];
  await Promise.all(
    imgs.map((i) =>
      i.complete && i.naturalWidth > 0
        ? Promise.resolve()
        : new Promise<void>((r) => {
            const done = () => {
              clearTimeout(timer);
              r();
            };
            const timer = setTimeout(() => {
              failed.push(i.src);
              done();
            }, 15_000);
            i.addEventListener("load", () => done(), { once: true });
            i.addEventListener(
              "error",
              () => {
                failed.push(i.src);
                done();
              },
              { once: true }
            );
          })
    )
  );
  return failed;
}

/** 1200×675 JPEG of the first export page for link previews; null if it can't be made small enough. */
async function capturePreview(node: HTMLElement): Promise<string | null> {
  for (const quality of [0.82, 0.65, 0.5]) {
    const url = await toJpeg(node, {
      quality,
      width: CANVAS_W,
      height: CANVAS_H,
      canvasWidth: 1200,
      canvasHeight: 675,
      pixelRatio: 1,
      backgroundColor: "#0f1923",
    });
    // Server cap is 512 KB of JPEG bytes; base64 adds a third.
    if (url.length < 680_000) return url;
  }
  return null;
}

function defaultChromaMap(payload: ShowcasePayload): ChromaSelection {
  const out: ChromaSelection = {};
  for (const s of payload.skins) {
    const id = s.defaultChromaId ?? s.chromas[0]?.id;
    if (id) out[s.id] = id;
  }
  return out;
}

export default function App() {
  const [data, setData] = useState<ShowcasePayload | null>(null);
  const [selection, setSelection] = useState<Selection>({});
  const [chromaSel, setChromaSel] = useState<ChromaSelection>({});
  const [bringToFront, setBringToFront] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [view, setView] = useState<View>("showcase");
  const [libTab, setLibTab] = useState<LibraryTab>("skin");
  const [exporting, setExporting] = useState(false);
  const [exportPhase, setExportPhase] = useState<string | null>(null);
  const [zoom, setZoom] = useState<"fit" | "100">("fit");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [shareEnabled, setShareEnabled] = useState(false);
  const [share, setShare] = useState<ShareUi>({ phase: "idle" });
  const stageRef = useRef<HTMLDivElement>(null);

  // Export canvas stays fixed 1280×720; only the preview scales.
  const fitScale = useFitScale(stageRef, [data, view]);

  useEffect(() => {
    const onFs = () => setIsFullscreen(document.fullscreenElement === stageRef.current);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  useEffect(() => {
    fetch("/api/share/config")
      .then((r) => (r.ok ? r.json() : { enabled: false }))
      .then((j) => setShareEnabled(!!j.enabled))
      .catch(() => setShareEnabled(false));
  }, []);

  // A link is a snapshot: once the selection moves on, flag it as outdated.
  useEffect(() => {
    setShare((s) => (s.phase === "ready" && !s.stale ? { ...s, stale: true } : s));
  }, [selection, chromaSel, bringToFront]);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void stageRef.current?.requestFullscreen?.().catch(() => undefined);
  };

  const previewScale = zoom === "fit" ? fitScale : 1;

  const pages = useMemo(() => (data ? paginate(data.skins, selection) : null), [data, selection]);

  function applyData(json: ShowcasePayload) {
    setData(json);
    setSelection(buildSelection(json));
    setChromaSel(defaultChromaMap(json));
    setPage(0);
  }

  /**
   * Toggle a selection. Card and title are single-slot on the showcase, so
   * picking one releases the others of that kind (radio-style); skins and
   * buddies stay multi-select.
   */
  const toggle = (kind: ItemKind, id: string) =>
    setSelection((s) => {
      const key = selKey(kind, id);
      const on = !s[key];
      if (!isSingleSlot(kind)) return { ...s, [key]: on };
      const prefix = `${kind}:`;
      const next = { ...s };
      if (on) for (const k of Object.keys(next)) if (k.startsWith(prefix)) next[k] = false;
      next[key] = on;
      return next;
    });

  const removeSkin = (id: string) => setSelection((s) => ({ ...s, [selKey("skin", id)]: false }));
  const bringSkinToFront = (gunId: string, skinId: string) => setBringToFront((m) => ({ ...m, [gunId]: skinId }));
  const pickChroma = (skinId: string, chromaId: string) => setChromaSel((s) => ({ ...s, [skinId]: chromaId }));

  const setSection = (kind: ItemKind, mode: "all" | "none" | "premium") => {
    if (!data) return;
    if (kind === "agent") {
      // The "main agent" is an identity pick, not a priced collection item:
      // Clear releases it; Premium+/Everything leave the chosen agent alone.
      if (mode !== "none") return;
      setSelection((s) => {
        const next = { ...s };
        for (const a of data.agents ?? []) next[selKey("agent", a.id)] = false;
        return next;
      });
      return;
    }
    const items: AnyItem[] = { skin: data.skins, card: data.cards, title: data.titles, buddy: data.buddies }[kind];
    if (isSingleSlot(kind)) {
      // One-slot kinds hold exactly one item: "all"/"premium" pick a single
      // winner (equipped first) instead of checking several at once.
      const qualifies = (it: AnyItem) => (mode === "all" ? true : mode === "none" ? false : it.price != null);
      setSelection((s) => pickSingleSlot(kind, items, qualifies, s));
      return;
    }
    setSelection((s) => {
      const next = { ...s };
      for (const it of items) {
        next[selKey(kind, it.id)] =
          mode === "all"
            ? true
            : mode === "none"
              ? false
              : kind === "skin"
                ? isPremiumSkin(it as SkinItem)
                : it.price != null;
      }
      return next;
    });
  };

  const allSections = (mode: "all" | "none" | "premium") =>
    (["skin", "card", "title", "buddy", "agent"] as ItemKind[]).forEach((k) => setSection(k, mode));

  async function exportImages() {
    if (!data || !pages) return;
    setExporting(true);
    setError(null);
    try {
      setExportPhase("Preparing assets…");
      await document.fonts.ready;
      const nodes = Array.from(document.querySelectorAll<HTMLElement>("[data-export-page]"));
      const failed = await waitForImages("[data-export-page] img");
      if (failed.length) {
        throw new Error(`${failed.length} artwork image(s) failed to load — check your connection and try again.`);
      }
      const slug = `${data.gameName}_${data.tagLine}`.replace(/[^\w-]+/g, "") || "account";
      for (let i = 0; i < nodes.length; i++) {
        setExportPhase(nodes.length > 1 ? `Rendering ${i + 1} of ${nodes.length}…` : "Rendering 2560 × 1440…");
        const url = await toPng(nodes[i], { pixelRatio: 2, backgroundColor: "#0f1923", width: CANVAS_W, height: CANVAS_H });
        const a = document.createElement("a");
        a.href = url;
        a.download = `showcase-${slug}-p${i + 1}.png`;
        a.click();
        await new Promise((r) => setTimeout(r, 400));
      }
      setExportPhase("Downloaded");
      await new Promise((r) => setTimeout(r, 1600));
    } catch (e) {
      setError(`Export failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setExportPhase(null);
      setExporting(false);
    }
  }

  async function createShareLink() {
    if (!data?.shareProof) {
      setShare({ phase: "error", message: "Sign in again to create a share link." });
      return;
    }
    setShare({ phase: "working", label: "Preparing preview…" });
    try {
      const on = (kind: ItemKind, id: string) => !!selection[selKey(kind, id)];
      const skins = data.skins.filter((s) => on("skin", s.id));
      const skinIds = new Set(skins.map((s) => s.id));
      const cards = data.cards.filter((c) => on("card", c.id));
      const titles = data.titles.filter((t) => on("title", t.id));
      const picks: SharePicks = {
        skins: skins.map((s) => ({ id: s.id, chroma: chromaSel[s.id] ?? null })),
        front: Object.fromEntries(Object.entries(bringToFront).filter(([, id]) => skinIds.has(id))),
        // Same pick the showcase renders for its single card/title slot.
        card: (cards.find((c) => c.equipped) ?? cards[0])?.id ?? null,
        title: (titles.find((t) => t.equipped) ?? titles[0])?.id ?? null,
        buddies: data.buddies.filter((b) => on("buddy", b.id)).map((b) => b.id),
        // The single "main agent" slot (radio-style selection).
        agent: (data.agents ?? []).find((a) => on("agent", a.id))?.id ?? null,
      };
      let preview: string | null = null;
      const node = document.querySelector<HTMLElement>("[data-export-page]");
      if (node) {
        await document.fonts.ready;
        const failed = await waitForImages("[data-export-page] img");
        // A broken preview shouldn't block the link itself.
        if (!failed.length) preview = await capturePreview(node).catch(() => null);
      }
      setShare({ phase: "working", label: "Creating link…" });
      const res = await fetch("/api/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proof: data.shareProof, picks, preview }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Couldn't create the link. Try again.");
      const url = `${window.location.origin}${json.path}`;
      const copied = await navigator.clipboard?.writeText(url).then(
        () => true,
        () => false
      );
      setShare({ phase: "ready", url, expiresAt: json.expiresAt, copied: !!copied, stale: false });
    } catch (e) {
      setShare({ phase: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }

  const resetAccount = () => {
    setData(null);
    setSelection({});
    setChromaSel({});
    setBringToFront({});
    setError(null);
    setPage(0);
    setView("showcase");
    setLibTab("skin");
    setZoom("fit");
    setExportPhase(null);
    setShare({ phase: "idle" });
  };

  const switchAccount = () => {
    if (!window.confirm("Switch account? Your current selection and showcase will be cleared.")) return;
    resetAccount();
  };

  if (!data || !pages) return <SignIn onLoaded={applyData} />;

  const equippedCard = data.cards.find((c) => c.equipped) ?? data.cards[0];
  const avatar = equippedCard?.avatar ?? equippedCard?.icon ?? null;

  const hasStore =
    !!data.store && (data.store.offers.length > 0 || data.store.nightMarket.length > 0 || data.store.accessories.length > 0);

  // Profile view: ranked record and/or recent matches (all non-critical data).
  const prof = data.profile;
  const hasProfile =
    !!prof &&
    (!!prof.ranked.act ||
      !!prof.ranked.career ||
      prof.ranked.winsByTier.length > 0 ||
      prof.matches.length > 0 ||
      !!prof.accountCreatedAt);

  return (
    <div className="studio">
      <header className="nav">
        <div className="nav-brand">
          <span className="brand-mark" aria-hidden="true" />
          <span className="nav-brand-name">Collection</span>
        </div>
        <nav className="switch nav-switch" aria-label="Views">
          <button type="button" className={view === "showcase" ? "on" : ""} aria-current={view === "showcase" ? "page" : undefined} onClick={() => setView("showcase")}>
            <IconShowcase />
            Showcase
          </button>
          {hasStore && (
            <button type="button" className={view === "store" ? "on" : ""} aria-current={view === "store" ? "page" : undefined} onClick={() => setView("store")}>
              <IconStore />
              Store
            </button>
          )}
          {hasProfile && (
            <button type="button" className={view === "profile" ? "on" : ""} aria-current={view === "profile" ? "page" : undefined} onClick={() => setView("profile")}>
              <IconProfile />
              Profile
            </button>
          )}
        </nav>
        <div className="nav-right">
          {(data.wallet.vp != null || data.wallet.rp != null) && (
            <div className="nav-wallet">
              {data.wallet.vp != null && (
                <span title="Valorant Points">
                  <img src={img(VP_ICON)} alt="VP" />
                  {fmt(data.wallet.vp)}
                </span>
              )}
              {data.wallet.rp != null && (
                <span title="Radianite Points">
                  <img src={img(RP_ICON)} alt="RP" />
                  {fmt(data.wallet.rp)}
                </span>
              )}
            </div>
          )}
          <div className="nav-account">
            <span className="nav-avatar" aria-hidden="true">
              {avatar && <img src={img(avatar)} alt="" />}
            </span>
            <span className="nav-player">
              <span className="nav-player-name">
                {data.gameName}
                {data.tagLine && <span className="nav-player-tag">#{data.tagLine}</span>}
              </span>
              <span className="nav-player-meta">
                {data.accountLevel != null && <>Level {data.accountLevel} · </>}
                {data.region.toUpperCase()}
              </span>
            </span>
            <button type="button" className="icon-btn" onClick={switchAccount} title="Switch account" aria-label="Switch account">
              <IconSwitch />
            </button>
          </div>
        </div>
      </header>

      {error && (
        <div className="error error--bar" role="alert">
          <span>{error}</span>
          <button type="button" className="btn-sm" onClick={() => setError(null)}>Dismiss</button>
        </div>
      )}

      {view === "showcase" ? (
        <div className="studio-body">
          <Library
            data={data}
            tab={libTab}
            onTab={setLibTab}
            selection={selection}
            chromaSel={chromaSel}
            onToggle={toggle}
            onSection={setSection}
          />

          <main className="stage-wrap">
            <div className="stage-bar">
              <div className="stage-title">
                <span>Preview</span>
                <span className="stage-hint">Hover a weapon to reorder, recolor or remove its skins</span>
              </div>
              <div className="switch switch--sm" role="group" aria-label="Preview zoom">
                <button type="button" className={zoom === "fit" ? "on" : ""} aria-pressed={zoom === "fit"} onClick={() => setZoom("fit")}>
                  <IconFit />
                  Fit
                </button>
                <button type="button" className={zoom === "100" ? "on" : ""} aria-pressed={zoom === "100"} onClick={() => setZoom("100")}>
                  100%
                </button>
              </div>
              <button type="button" className="icon-btn" onClick={toggleFullscreen} title={isFullscreen ? "Exit fullscreen" : "Fullscreen"} aria-label={isFullscreen ? "Exit fullscreen" : "Fullscreen"}>
                <IconExpand />
              </button>
            </div>
            <div className={`stage${zoom === "100" ? " stage--actual" : ""}`} ref={stageRef}>
              <div
                className="stage-frame"
                style={{ width: Math.round(CANVAS_W * previewScale), height: Math.round(CANVAS_H * previewScale) }}
              >
                <div className="stage-scale" style={{ transform: `scale(${previewScale})` }}>
                  <Showcase
                    payload={data}
                    pages={pages}
                    page={page}
                    selection={selection}
                    chromaSel={chromaSel}
                    bringToFront={bringToFront}
                    onRemoveSkin={removeSkin}
                    onBringToFront={bringSkinToFront}
                    onPickChroma={pickChroma}
                  />
                </div>
              </div>
            </div>
          </main>

          <Inspector
            data={data}
            pages={pages}
            page={page}
            onPage={setPage}
            selection={selection}
            chromaSel={chromaSel}
            exportPhase={exportPhase}
            exporting={exporting}
            onExport={exportImages}
            onPreset={allSections}
            onPickChroma={pickChroma}
            onOpenTab={setLibTab}
            share={shareEnabled ? share : null}
            onShare={createShareLink}
          />
        </div>
      ) : view === "store" ? (
        <main className="store-view pane-scroll">
          <header className="page-head">
            <h1>Store</h1>
            <p>Today&apos;s offers on this account. Owned items are marked; hover any card to inspect it.</p>
          </header>
          {data.store && <StorePanel store={data.store} generatedAt={data.generatedAt} />}
        </main>
      ) : (
        data.profile && (
          <main className="store-view pane-scroll">
            <ProfilePanel profile={data.profile} ranks={data.ranks} />
          </main>
        )
      )}

      <div className="hidden-export" aria-hidden="true">
        {pages.gridPages.map((_, i) => (
          <div key={i} data-export-page>
            <Showcase
              payload={data}
              pages={pages}
              page={i}
              selection={selection}
              chromaSel={chromaSel}
              bringToFront={bringToFront}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
