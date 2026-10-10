import { useMemo, useState, type CSSProperties } from "react";
import type { ChromaSelection, ItemKind, Selection, ShowcasePayload, SkinItem } from "./types";
import { selKey } from "./types";
import { favoriteAgent, groupByGun, rarityColor, rarityLabel, WEAPON_CATEGORIES } from "./logic";
import { SkinArt } from "./skinArt";

const img = (u: string | null | undefined) => (u ? `/img/${encodeURIComponent(u)}` : undefined);
const fmt = (n: number) => n.toLocaleString("en-US");

export type LibraryTab = "skin" | "card" | "title" | "buddy" | "agent";
type SkinFilter = "all" | "selected" | "equipped";

const CLASS_LABEL: Record<string, string> = {
  SIDEARMS: "Sidearms",
  SMGS: "SMGs",
  SHOTGUNS: "Shotguns",
  RIFLES: "Rifles",
  SNIPERS: "Snipers",
  HEAVIES: "Heavies",
};

/** Library class filter: one chip per showcase section, plus melee. */
const CLASSES: { id: string; label: string; guns: readonly string[] | null }[] = [
  { id: "all", label: "All", guns: null },
  ...WEAPON_CATEGORIES.flatMap((c) =>
    c.sections.map((s) => ({ id: s.label, label: CLASS_LABEL[s.label] ?? s.label, guns: s.guns.map((g) => g.toUpperCase()) }))
  ),
  { id: "MELEE", label: "Melee", guns: ["MELEE"] },
];

interface Props {
  data: ShowcasePayload;
  tab: LibraryTab;
  onTab: (tab: LibraryTab) => void;
  selection: Selection;
  chromaSel: ChromaSelection;
  onToggle: (kind: ItemKind, id: string) => void;
  onSection: (kind: ItemKind, mode: "all" | "none" | "premium") => void;
}

export function Library({ data, tab, onTab, selection, chromaSel, onToggle, onSection }: Props) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<SkinFilter>("all");
  const [cls, setCls] = useState("all");
  const isOn = (kind: ItemKind, id: string) => !!selection[selKey(kind, id)];

  const counts = {
    skin: data.skins.filter((s) => isOn("skin", s.id)).length,
    card: data.cards.filter((s) => isOn("card", s.id)).length,
    title: data.titles.filter((s) => isOn("title", s.id)).length,
    buddy: data.buddies.filter((s) => isOn("buddy", s.id)).length,
    agent: (data.agents ?? []).filter((a) => isOn("agent", a.id)).length,
  };
  const totals = {
    skin: data.skins.length,
    card: data.cards.length,
    title: data.titles.length,
    buddy: data.buddies.length,
    agent: data.agents?.length ?? 0,
  };

  const q = query.trim().toLowerCase();
  const skinGroups = useMemo(() => {
    let items = data.skins;
    if (q) items = items.filter((s) => s.name.toLowerCase().includes(q) || s.weaponName.toLowerCase().includes(q));
    if (filter === "selected") items = items.filter((s) => selection[selKey("skin", s.id)]);
    else if (filter === "equipped") items = items.filter((s) => s.equipped);
    const guns = CLASSES.find((c) => c.id === cls)?.guns;
    const groups = groupByGun(items);
    return guns ? groups.filter((g) => guns.includes(g.id)) : groups;
  }, [data.skins, q, filter, cls, selection]);

  const match = (name: string) => !q || name.toLowerCase().includes(q);

  const skinTile = (s: SkinItem) => {
    const on = isOn("skin", s.id);
    const ch = s.chromas.find((c) => c.id === (chromaSel[s.id] ?? s.defaultChromaId)) ?? s.chromas[0];
    const icon = ch?.icon ?? s.icon;
    const rarity = rarityColor(s.price, s.levelCount, s.contentTierRank ?? null);
    const tier = rarityLabel(s.price, s.levelCount, s.contentTierRank ?? null).toLowerCase();
    return (
      <button
        key={s.id}
        type="button"
        className={`lib-skin${on ? " on" : ""}`}
        style={{ "--rarity": rarity } as CSSProperties}
        onClick={() => onToggle("skin", s.id)}
        aria-pressed={on}
        title={`${s.name} · ${tier}${s.price != null ? ` · ${fmt(s.price)} VP` : ""}${s.equipped ? " · equipped" : ""}`}
      >
        <span className="lib-skin-art">
          {icon ? <SkinArt src={img(icon)!} alt="" loading="lazy" weaponName={s.weaponName} isKnife={s.isKnife} /> : null}
        </span>
        <span className="lib-skin-info">
          <span className="lib-skin-name">{s.name}</span>
          <span className="lib-skin-meta">
            {s.price != null ? <span className="lib-price">{fmt(s.price)} VP</span> : <span className="lib-price">—</span>}
            {s.equipped && <span className="lib-skin-eq">Equipped</span>}
          </span>
        </span>
        <span className="lib-check" aria-hidden="true" />
      </button>
    );
  };

  const searchable = tab !== "title" || data.titles.length > 0;

  return (
    <aside className="pane pane--library" aria-label="Library">
      <div className="tabs tabs--pane" role="tablist" aria-label="Library">
        {(
          [
            ["skin", "Skins"],
            ["card", "Cards"],
            ["title", "Titles"],
            ["buddy", "Buddies"],
            ["agent", "Agents"],
          ] as const
        ).map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? "on" : ""} onClick={() => onTab(id)}>
            {label}
            <span className="tab-count" title={`${counts[id]} of ${totals[id]} selected`}>
              {counts[id]}
            </span>
          </button>
        ))}
      </div>

      <div className="lib-tools">
        {searchable && (
          <input
            type="search"
            className="lib-search"
            placeholder={tab === "skin" ? "Search skins or weapons" : "Search"}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search library"
          />
        )}
        {tab === "skin" ? (
          <>
            <div className="switch switch--sm switch--fill" role="group" aria-label="Filter skins">
              {(["all", "selected", "equipped"] as const).map((f) => (
                <button key={f} type="button" className={filter === f ? "on" : ""} aria-pressed={filter === f} onClick={() => setFilter(f)}>
                  {f[0].toUpperCase() + f.slice(1)}
                </button>
              ))}
            </div>
            <div className="chips" role="group" aria-label="Weapon class">
              {CLASSES.map((c) => (
                <button key={c.id} type="button" className={cls === c.id ? "on" : ""} aria-pressed={cls === c.id} onClick={() => setCls(c.id)}>
                  {c.label}
                </button>
              ))}
            </div>
          </>
        ) : (
          <div className="lib-bulk">
            {tab === "buddy" ? (
              <>
                <button type="button" className="btn-sm" onClick={() => onSection("buddy", "all")}>Select all</button>
                <button type="button" className="btn-sm" onClick={() => onSection("buddy", "premium")}>Paid only</button>
              </>
            ) : (
              <span className="lib-bulk-note">One {tab} appears on the showcase</span>
            )}
            <button type="button" className="btn-sm" onClick={() => onSection(tab, "none")}>Clear</button>
          </div>
        )}
      </div>

      <div className="pane-scroll lib-body">
        {tab === "skin" && (
          <>
            {skinGroups.length === 0 && (
              <p className="lib-empty">{q || filter !== "all" || cls !== "all" ? "No skins match these filters." : "No skins on this account."}</p>
            )}
            {skinGroups.map((g) => {
              const sel = g.items.filter((i) => isOn("skin", i.id)).length;
              return (
                <section className="lib-group" key={g.id}>
                  <header className="lib-group-head">
                    {data.defaultIcons?.[g.id] && <img className="lib-group-icon" src={img(data.defaultIcons[g.id])} alt="" />}
                    <span className="lib-group-name">{g.label}</span>
                    <span className="lib-group-rule" aria-hidden="true" />
                    <span className="lib-group-count">
                      {sel}/{g.items.length}
                    </span>
                  </header>
                  <div className="lib-grid">{g.items.map(skinTile)}</div>
                </section>
              );
            })}
          </>
        )}

        {tab === "card" && (
          <div className="lib-cards">
            {data.cards.filter((c) => match(c.name)).map((c) => {
              const on = isOn("card", c.id);
              return (
                <button
                  key={c.id}
                  type="button"
                  className={`lib-card${on ? " on" : ""}`}
                  onClick={() => onToggle("card", c.id)}
                  aria-pressed={on}
                  title={c.name}
                >
                  {c.icon ? <img src={img(c.icon)} alt="" loading="lazy" /> : <span className="lib-card-fb">{c.name}</span>}
                  <span className="lib-check" aria-hidden="true" />
                  {c.equipped && <span className="lib-eq">Equipped</span>}
                  <span className="lib-card-name">{c.name}</span>
                </button>
              );
            })}
            {data.cards.length === 0 && <p className="lib-empty">No cards on this account.</p>}
          </div>
        )}

        {tab === "title" && (
          <div className="lib-titles" role="radiogroup" aria-label="Player title">
            {data.titles.filter((t) => match(t.text || t.name)).map((t) => {
              const on = isOn("title", t.id);
              return (
                <button
                  key={t.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  className={`lib-title${on ? " on" : ""}`}
                  onClick={() => onToggle("title", t.id)}
                >
                  <span className="lib-radio" aria-hidden="true" />
                  <span className="lib-title-text">{t.text || t.name}</span>
                  {t.equipped && <span className="lib-eq lib-eq--inline">Equipped</span>}
                </button>
              );
            })}
            {data.titles.length === 0 && <p className="lib-empty">No titles on this account.</p>}
          </div>
        )}

        {tab === "buddy" && (
          <div className="lib-buddies">
            {data.buddies.filter((b) => match(b.name)).map((b) => {
              const on = isOn("buddy", b.id);
              return (
                <button
                  key={b.id}
                  type="button"
                  className={`lib-buddy${on ? " on" : ""}`}
                  onClick={() => onToggle("buddy", b.id)}
                  aria-pressed={on}
                  title={b.name}
                >
                  <span className="lib-check" aria-hidden="true" />
                  <span className="lib-buddy-art">{b.icon ? <img src={img(b.icon)} alt="" loading="lazy" /> : null}</span>
                  <span className="lib-buddy-name">{b.name.replace(/ Buddy$/i, "")}</span>
                </button>
              );
            })}
            {data.buddies.length === 0 && <p className="lib-empty">No buddies on this account.</p>}
          </div>
        )}

        {tab === "agent" && (
          <div className="lib-agents">
            {(() => {
              const favId = favoriteAgent(data)?.id ?? null;
              // Most-played agent first (badge + default pick), then A→Z.
              const agents = [...(data.agents ?? [])].sort(
                (a, b) => (a.id === favId ? -1 : 0) - (b.id === favId ? -1 : 0) || a.name.localeCompare(b.name)
              );
              const list = agents.filter(
                (a) => !q || a.name.toLowerCase().includes(q) || (a.role ?? "").toLowerCase().includes(q)
              );
              if (!list.length) {
                return <p className="lib-empty">{totals.agent === 0 ? "No agents on this account." : "No agents match these filters."}</p>;
              }
              return list.map((a) => {
                const on = isOn("agent", a.id);
                return (
                  <button
                    key={a.id}
                    type="button"
                    className={`lib-agent${on ? " on" : ""}`}
                    onClick={() => onToggle("agent", a.id)}
                    aria-pressed={on}
                    title={`${a.name}${a.role ? ` · ${a.role}` : ""}`}
                  >
                    <span className="lib-check" aria-hidden="true" />
                    <span className="lib-agent-art">
                      {a.icon ? <img src={img(a.icon)} alt="" loading="lazy" /> : null}
                    </span>
                    <span className="lib-agent-info">
                      <span className="lib-agent-name">{a.name}</span>
                      {a.role && (
                        <span className="lib-agent-role">
                          {a.roleIcon && <img src={img(a.roleIcon)} alt="" />}
                          {a.role}
                        </span>
                      )}
                    </span>
                    {a.id === favId && <span className="lib-agent-fav">Most played</span>}
                  </button>
                );
              });
            })()}
          </div>
        )}
      </div>
    </aside>
  );
}
