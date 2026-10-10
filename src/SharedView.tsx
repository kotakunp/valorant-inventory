import { useEffect, useMemo, useRef, useState } from "react";
import type { SharedShowcase, Selection } from "./types";
import { selKey } from "./types";
import { paginate } from "./logic";
import { Showcase, CANVAS_W, CANVAS_H } from "./Showcase";
import { useFitScale } from "./useFitScale";
import { IconArrowRight, IconExpand } from "./icons";

const img = (u: string) => `/img/${encodeURIComponent(u)}`;
const dateFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });

type State = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; share: SharedShowcase };

/** Read-only page behind `/s/:id`: the shared showcase with hover browsing. */
export function SharedView({ id }: { id: string }) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [page, setPage] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    fetch(`/api/share/${encodeURIComponent(id)}`)
      .then(async (res) => {
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error ?? "This link has expired or doesn't exist.");
        return json as SharedShowcase;
      })
      .then((share) => {
        if (!alive) return;
        setState({ kind: "ready", share });
      })
      .catch((e: unknown) => {
        if (alive) setState({ kind: "error", message: e instanceof Error ? e.message : String(e) });
      });
    return () => {
      alive = false;
    };
  }, [id]);

  const share = state.kind === "ready" ? state.share : null;
  const p = share?.showcase;
  const who = p ? (p.tagLine ? `${p.gameName}#${p.tagLine}` : p.gameName) : "";

  useEffect(() => {
    if (who) document.title = `${who} · VALORANT collection`;
  }, [who]);

  useEffect(() => {
    const onFs = () => setIsFullscreen(document.fullscreenElement === stageRef.current);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  // A share stores only what was shown, so everything in it is selected.
  const selection = useMemo<Selection>(() => {
    const sel: Selection = {};
    if (!p) return sel;
    p.skins.forEach((i) => (sel[selKey("skin", i.id)] = true));
    p.cards.forEach((i) => (sel[selKey("card", i.id)] = true));
    p.titles.forEach((i) => (sel[selKey("title", i.id)] = true));
    p.buddies.forEach((i) => (sel[selKey("buddy", i.id)] = true));
    return sel;
  }, [p]);
  const pages = useMemo(() => (p ? paginate(p.skins, selection) : null), [p, selection]);
  const scale = useFitScale(stageRef, [share], 1.25);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void stageRef.current?.requestFullscreen?.().catch(() => undefined);
  };

  const card = p?.cards[0];
  const avatar = card?.avatar ?? card?.icon ?? null;
  const pageCount = pages?.gridPages.length ?? 0;

  return (
    <div className="studio shared">
      <header className="nav">
        <a className="nav-brand" href="/" aria-label="VALORANT Collection home">
          <span className="brand-mark" aria-hidden="true" />
          <span className="nav-brand-name">Collection</span>
        </a>
        {p && (
          <div className="shared-owner">
            <span className="nav-avatar" aria-hidden="true">
              {avatar && <img src={img(avatar)} alt="" />}
            </span>
            <span className="nav-player">
              <span className="nav-player-name">
                {p.gameName}
                {p.tagLine && <span className="nav-player-tag">#{p.tagLine}</span>}
              </span>
              <span className="nav-player-meta">
                {p.accountLevel != null && <>Level {p.accountLevel} · </>}
                {p.region.toUpperCase()}
              </span>
            </span>
          </div>
        )}
        <div className="nav-right">
          <a className="btn btn-primary shared-cta" href="/">
            Make your own
            <IconArrowRight />
          </a>
        </div>
      </header>

      {state.kind !== "ready" || !p || !pages ? (
        <main className="shared-empty">
          {state.kind === "loading" ? (
            <p className="shared-empty-text">Loading showcase…</p>
          ) : (
            <div className="shared-empty-card">
              <h1>Link unavailable</h1>
              <p>{state.kind === "error" ? state.message : "This link has expired or doesn't exist."}</p>
              <p className="shared-empty-sub">Shared links last 30 days. You can build your own showcase in a minute.</p>
              <a className="btn btn-primary" href="/">
                Make your own
                <IconArrowRight />
              </a>
            </div>
          )}
        </main>
      ) : (
        <main className="stage-wrap">
          <div className="stage-bar">
            <div className="stage-title">
              <span>Collection</span>
              <span className="stage-hint">Hover a weapon to see every skin</span>
            </div>
            {pageCount > 1 && (
              <span className="pager" aria-label="Page">
                <button type="button" onClick={() => setPage((n) => Math.max(0, n - 1))} disabled={page === 0} aria-label="Previous page">‹</button>
                <span>
                  {page + 1} / {pageCount}
                </span>
                <button type="button" onClick={() => setPage((n) => Math.min(pageCount - 1, n + 1))} disabled={page >= pageCount - 1} aria-label="Next page">›</button>
              </span>
            )}
            <button type="button" className="icon-btn" onClick={toggleFullscreen} title={isFullscreen ? "Exit fullscreen" : "Fullscreen"} aria-label={isFullscreen ? "Exit fullscreen" : "Fullscreen"}>
              <IconExpand />
            </button>
          </div>
          <div className="stage" ref={stageRef}>
            <div className="stage-frame" style={{ width: Math.round(CANVAS_W * scale), height: Math.round(CANVAS_H * scale) }}>
              <div className="stage-scale" style={{ transform: `scale(${scale})` }}>
                <Showcase
                  payload={p}
                  pages={pages}
                  page={page}
                  selection={selection}
                  chromaSel={share!.chromaSel ?? {}}
                  bringToFront={share!.bringToFront}
                  hoverable
                />
              </div>
            </div>
          </div>
          <footer className="shared-foot">
            Shared {dateFmt.format(new Date(share!.createdAt))} · link expires {dateFmt.format(new Date(share!.expiresAt))}.
            Unofficial tool, not affiliated with Riot Games.
          </footer>
        </main>
      )}
    </div>
  );
}
