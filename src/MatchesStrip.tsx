import { useEffect, useMemo, useState } from "react";
import { SectionHead } from "./StorePanel";
import { filterMatches, queueTabs } from "./logic";
import type { RecentMatch } from "./types";

const imgUrl = (u: string | null) => (u ? `/img/${encodeURIComponent(u)}` : null);

/** "2h ago" / "5d ago" — refreshed every minute by the strip's tick. */
function ago(iso: string, now: number): string {
  const diff = Math.max(0, now - Date.parse(iso));
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/** Match length → "32:14" (mm:ss) / "1:03:22" (h:mm:ss). */
function duration(ms: number | null): string | null {
  if (!ms || ms <= 0) return null;
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
    : `${m}:${String(sec).padStart(2, "0")}`;
}

function MatchCard({ m, now }: { m: RecentMatch; now: number }) {
  const result = m.won === true ? "WIN" : m.won === false ? "LOSS" : "DRAW";
  const cls = m.won === true ? "win" : m.won === false ? "loss" : "draw";
  const dur = duration(m.durationMs);
  const agentImg = imgUrl(m.agentIcon);
  return (
    <article className={`smatch-card ${cls}`} title={`${m.mode} · ${m.map} · ${m.agent} · ${result}`}>
      <div className="smatch-top">
        <span className={`smatch-result ${cls}`}>{result}</span>
        <span className="smatch-mode">{m.mode}</span>
      </div>
      <div className="smatch-map-row">
        <span className="smatch-map">{m.map}</span>
        {m.score && (
          <span className="smatch-score">
            {m.score.mine}&ndash;{m.score.theirs}
          </span>
        )}
      </div>
      <div className="smatch-stat">
        {agentImg && <img className="smatch-agent" src={agentImg} alt="" />}
        <span className="smatch-kda">
          {m.kills}/{m.deaths}/{m.assists}
        </span>
        <span className="smatch-acs">{m.acs} ACS</span>
      </div>
      <div className="smatch-foot">
        {m.rr != null && (
          <span className={`smatch-rr ${m.rr >= 0 ? "up" : "down"}`}>
            {m.rr >= 0 ? "+" : ""}
            {m.rr} RR
          </span>
        )}
        <span className="smatch-when">
          {[dur, ago(m.start, now)].filter(Boolean).join(" · ")}
        </span>
      </div>
    </article>
  );
}

/**
 * Editor-only recent-match strip under the preview (sibling of the store
 * strip): queue tabs filter a compact W/L card per match — never exported,
 * hidden in fullscreen, omitted entirely when there are no matches.
 */
export function MatchesStrip({ matches, width }: { matches: RecentMatch[]; width?: number }) {
  const [tab, setTab] = useState("");
  // Relative times ("2h ago") refresh once a minute.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  const tabs = useMemo(() => queueTabs(matches), [matches]);
  const list = useMemo(() => filterMatches(matches, tab), [matches, tab]);
  const wins = list.filter((m) => m.won === true).length;
  const losses = list.filter((m) => m.won === false).length;

  return (
    <div className="matches-strip" style={width ? { width } : undefined}>
      <section>
        <SectionHead label="RECENT MATCHES" time={`${wins}W ${losses}L`} />
        <div className="seg smatch-tabs">
          {tabs.map((t) => (
            <button
              key={t.id || "all"}
              type="button"
              className={tab === t.id ? "on" : ""}
              aria-pressed={tab === t.id}
              onClick={() => setTab(t.id)}
            >
              {t.label} {t.count}
            </button>
          ))}
        </div>
        <div className="sstore-row sstore-row--scroll">
          {list.map((m) => (
            <MatchCard key={m.id} m={m} now={Date.now()} />
          ))}
        </div>
      </section>
    </div>
  );
}
