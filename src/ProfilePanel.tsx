import type { ProfileStats, Ranks } from "./types";
import { matchDuration, relTime, tierInfo, winratePct } from "./logic";

const img = (u: string | null | undefined) => (u ? `/img/${encodeURIComponent(u)}` : undefined);
const fmt = (n: number) => n.toLocaleString("en-US");

const dateFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });

/**
 * Editor-only Profile view (like the Store view): ranked record straight from
 * the MMR payload plus the last ≤10 matches' stats. Never part of the PNG
 * export — the showcase stays a cosmetics image.
 */
export function ProfilePanel({ profile, ranks }: { profile: ProfileStats; ranks: Ranks }) {
  const { ranked, matches, window: win, accountCreatedAt } = profile;
  const act = ranked.act;
  const career = ranked.career;
  const actWr = act ? winratePct(act.wins, act.games) : null;
  const careerWr = career ? winratePct(career.wins, career.games) : null;
  const topAgents = win?.topAgents.slice(0, 5) ?? [];

  return (
    <>
      <header className="page-head">
        <h1>Profile</h1>
        <p>
          Ranked record and the last {matches.length > 0 ? matches.length : "few"} matches on this
          account{accountCreatedAt ? ` · created ${dateFmt.format(new Date(accountCreatedAt))}` : ""}. Editor-only —
          never part of the exported image.
        </p>
      </header>

      <div className="profile-grid">
        <section className="profile-card">
          <h3 className="profile-head">Ranked</h3>
          {act ? (
            <>
              <div className="profile-rank-top">
                {ranks.currentBadge?.icon ? (
                  <img className="profile-rank-icon" src={img(ranks.currentBadge.icon)} alt="" />
                ) : null}
                <span className="profile-rank-meta">
                  <span className="profile-rank-name" style={{ color: ranks.currentBadge?.color }}>
                    {ranks.currentBadge?.name ?? tierInfo(ranks.current).name}
                  </span>
                  {act.rr != null && <span className="profile-rank-rr">{fmt(act.rr)} RR</span>}
                </span>
              </div>
              <dl className="profile-stats">
                <div>
                  <dt>Act winrate</dt>
                  <dd>
                    {actWr != null ? actWr : "—"}
                    <small>%</small>
                  </dd>
                </div>
                <div>
                  <dt>Act record</dt>
                  <dd>
                    {act.wins}
                    <small>W</small> {act.games - act.wins}
                    <small>L</small>
                  </dd>
                </div>
              </dl>
              {career && (
                <p className="profile-line">
                  Career: {fmt(career.wins)}W {fmt(career.games - career.wins)}L
                  {careerWr != null && <span className="profile-muted"> · {careerWr}%</span>}
                </p>
              )}
              {ranked.winsByTier.length > 0 && (
                <div className="profile-tier-wins">
                  <span className="profile-tier-label">Wins by tier</span>
                  <span className="profile-pills">
                    {ranked.winsByTier.slice(0, 4).map((t) => (
                      <span
                        key={t.tier}
                        className="profile-pill"
                        style={{ borderColor: `${tierInfo(t.tier).color}55`, color: tierInfo(t.tier).color }}
                      >
                        {t.wins} · {tierInfo(t.tier).name}
                      </span>
                    ))}
                  </span>
                </div>
              )}
              {ranked.leaderboardRank != null && (
                <p className="profile-line profile-muted">Leaderboard #{fmt(ranked.leaderboardRank)}</p>
              )}
            </>
          ) : (
            <p className="profile-none">No ranked games in the current act.</p>
          )}
        </section>

        <section className="profile-card">
          <h3 className="profile-head">Recent form</h3>
          {win ? (
            <>
              <div className="profile-form" role="img" aria-label={`Last ${win.form.length}: ${win.form.join(", ")}`}>
                {win.form.map((f, i) => (
                  <span key={i} className={`profile-form-chip is-${f.toLowerCase()}`}>
                    {f}
                  </span>
                ))}
              </div>
              <dl className="profile-stats">
                <div>
                  <dt>Winrate</dt>
                  <dd>
                    {winratePct(win.wins, win.games) ?? "—"}
                    <small>%</small>
                  </dd>
                </div>
                <div>
                  <dt>K/D</dt>
                  <dd>{win.kd != null ? win.kd.toFixed(2) : "—"}</dd>
                </div>
                <div>
                  <dt>HS</dt>
                  <dd>
                    {win.hsPct != null ? win.hsPct : "—"}
                    <small>%</small>
                  </dd>
                </div>
                <div>
                  <dt>ACS</dt>
                  <dd>{win.acs ?? "—"}</dd>
                </div>
              </dl>
              <p className="profile-line">
                {win.wins}W {win.losses}L{win.draws > 0 ? ` ${win.draws}D` : ""} in {win.games} games
                {win.topMap && (
                  <>
                    {" "}
                    · <span className="profile-muted">most on {win.topMap.name}</span>
                  </>
                )}
              </p>
            </>
          ) : (
            <p className="profile-none">No recent matches available.</p>
          )}
        </section>

        <section className="profile-card">
          <h3 className="profile-head">Top agents</h3>
          {topAgents.length > 0 ? (
            <ul className="profile-agents">
              {topAgents.map((a) => (
                <li key={a.id || a.name} className="profile-agent">
                  <span className="profile-agent-art">
                    {a.icon ? <img src={img(a.icon)} alt="" loading="lazy" /> : null}
                  </span>
                  <span className="profile-agent-name">{a.name}</span>
                  <span className="profile-agent-stat">
                    {a.games}g · {winratePct(a.wins, a.games) ?? 0}%
                  </span>
                  <span className="profile-agent-kd">
                    {a.deaths > 0 ? (a.kills / a.deaths).toFixed(2) : "∞"} K/D
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="profile-none">No matches to summarize.</p>
          )}
        </section>
      </div>

      <section className="profile-matches">
        <h3 className="profile-head">Recent matches</h3>
        {matches.length > 0 ? (
          <ul className="profile-match-list">
            {matches.map((m) => (
              <li key={m.id} className="profile-match">
                <span className={`profile-result${m.won === true ? " is-win" : m.won === false ? " is-loss" : ""}`}>
                  {m.won === true ? "WIN" : m.won === false ? "LOSS" : "DRAW"}
                </span>
                <span className="profile-match-mode">{m.mode}</span>
                <span className="profile-match-map">
                  {m.mapIcon ? <img src={img(m.mapIcon)} alt="" loading="lazy" /> : null}
                  {m.map}
                </span>
                <span className="profile-match-score">
                  {m.score ? `${m.score.mine}–${m.score.theirs}` : "—"}
                </span>
                <span className="profile-match-agent">
                  {m.agentIcon ? <img src={img(m.agentIcon)} alt="" loading="lazy" /> : null}
                  {m.agent}
                </span>
                <span className="profile-match-kda">
                  {m.kills}/{m.deaths}/{m.assists}
                </span>
                <span className="profile-match-num">{m.acs} ACS</span>
                <span className="profile-match-num">{m.hsPct != null ? `${m.hsPct}% HS` : ""}</span>
                <span className={`profile-match-rr${m.rr != null ? (m.rr >= 0 ? " is-up" : " is-down") : ""}`}>
                  {m.rr != null ? `${m.rr > 0 ? "+" : ""}${m.rr} RR` : ""}
                </span>
                <span className="profile-match-time">
                  {matchDuration(m.durationMs)}
                  {matchDuration(m.durationMs) && " · "}
                  {relTime(m.start)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="profile-none">No matches were returned for this account.</p>
        )}
      </section>
    </>
  );
}
