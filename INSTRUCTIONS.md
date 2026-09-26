# INSTRUCTIONS — What we are building & what the user must see

**Repo:** valorant-store · **Spec:** `SPEC.md` (product/tech detail) · **Workflow/architecture:** `README.md`
This file = the short brief. If UI behavior and this file disagree, update both.

---

## What we are doing

A web app that turns a VALORANT account's cosmetics into a **single downloadable
2560×1440 (1440p) 16:9 PNG** that looks like the **official client's Collection /
loadout screen** — for the account owner to attach to a listing or show off.
Output is a PNG file only: no share links, no gallery, nothing stored.

The user signs in (cookie paste / remote browser / password / access URL / RSO),
the server pulls their inventory from Riot's unofficial endpoints, and the app
renders a pixel-faithful loadout preview they can curate and export.

## User journey (what happens, in order)

1. **Sign-in gate** — dark card, Riot-styled. Primary path first: **browser cookie**
   (`LOAD COLLECTION`, 4-step "Where do I find this?" how-to with a direct link to
   auth.riotgames.com); region is **auto-detected** (Riot Geo) so there is no
   server picker — only the collapsed access-URL panel keeps one. Everything else
   under **Other sign-in methods ▾** (remote login, password, access URL, RSO when
   configured). Cookie failures show human-readable copy + **Try again**.
2. **Workspace** loads with the account's inventory (~75% preview / ~25% sidebar).
   Defaults pre-check premium skins (≥1775 VP / Premium+ tier) and everything
   equipped — noted in the sidebar.
3. **Curation** — user toggles what appears (search, ALL/SELECTED/EQUIPPED
   filter, collapsible weapon categories); the preview updates live.
4. **Export** — "DOWNLOAD IMAGE (1440P)" (or "DOWNLOAD N IMAGES" when
   paginated), showing phases: `PREPARING ASSETS…` → `RENDERING 2560 × 1440…`
   / `RENDERING i / n…` → `DOWNLOADED ✓`. File: `showcase-<riotid>-p1.png`…

---

## What must be visible to the user

### Workspace chrome (not part of the exported PNG)

- **Top bar:** brand mark + `COLLECTION`, `Name#TAG · LV. n · REGION`,
  `x/y selected` (+ `density · page i/n` when multi-page), **Switch account**
  button (confirm dialog clears the selection).
- **Left sidebar (~25%, controls):**
  - Selection panel: `x selected` + *Premium+ / Select all / Clear* + the note
    "Premium+ and equipped cosmetics were selected automatically."
  - **Skins** panel: count `x/y`, search box, `ALL / SELECTED / EQUIPPED`
    segmented filter, collapsible weapon categories with `LABEL sel/total`
    counts; each cell is art-dominant — **art + name + VP price**, thin
    rarity-tinted outline + corner diamond when selected, subtle accent edge
    when equipped (label in tooltip). No glow.
  - **Cards / Titles / Buddies** panels: chip rows with checkboxes + prices
    (+ per-section *All / Premium / None*).
  - (No FM / PROOF footer-fields panel — removed.)
- **Preview bar:** download button (with export phase text), page pager
  `◀ 1/N ▶` when multi-page, hint *"Hover a stack to browse its skins"*,
  and **Fit / 100% / Fullscreen** zoom controls (editor-only — the exported
  geometry never changes).
- **Preview frame:** the live 1280×720 showcase, scaled to fit (or actual
  size / fullscreen on demand).
- **Store strip** (under the frame, editor-only — hidden in fullscreen,
  never exported): game-style rule headers — `DAILY OFFERS` + live
  `HH:MM:SS` rotation countdown, `NIGHT MARKET` (struck standard + accent
  discount) and `ACCESSORIES` (Kingdom-Credit prices) when active. Skin
  cards show a rarity-tinted outline + the official tier-gem icon with a
  rarity label (ULTRA / PREMIUM / SELECT / STANDARD) above the
  currency-icon price and `OWNED` badge;
  accessory rows scroll horizontally when long. Width tracks the preview
  frame at any zoom.

### The showcase itself (this IS the exported image)

```
HEADER      Riot ID #TAG · LV n · region · equipped title
CENTER                                    │ RIGHT RAIL
SIDEARMS column (full height)            │ player card (tall art, dominant)
SMGS over SMGs, then SHOTGUNS            │ RANK block: PEAK / CURRENT rows
RIFLES column                            │ VP / RP wallet (one row)
SNIPERS over snipers, then HEAVIES       │ PREMIUM n · KNIFE n · BUDDIES +n
── MELEE strip (cols 2–4, ~68px) ──      │
```

Must be visible / true:

- **Exactly 4 category columns**; combined columns show **section titles
  mid-column** (SMGS above SMGs, SHOTGUNS above shotguns; SNIPERS then HEAVIES).
- **All 19 official guns always present**, even empty (dimmed default-weapon
  render, no border, no `+`/labels); empty MELEE strip always shown. Unknown
  guns → OTHER column.
- **Skin stacks**: multiple skins per gun layered in one cell as a **two-axis
  cascade** — front skin centered, rest recede diagonally (left columns
  down-right, right columns down-left), spread bounded so nothing escapes the
  cell; front order = manual "show in front" → equipped → rarity/price →
  original. **Outline = the skin's rarity color** (gold `#e8c860` / purple
  `#a866ff` / blue `#7fa3c8`), hover opens an unscaled spread with individually hoverable skins.
- **Hover a weapon stack → nearby skin spread**: no click required. Every skin
  has its own large, stationary row; hover highlights the row and enlarges its
  artwork without moving its pointer target. Long stacks scroll. A short leave
  delay bridges the gap between stack and spread. Variants, front ordering,
  and removal are available directly on each row; no inspector or edit mode.
  Keyboard focus also opens the spread, Escape dismisses it; touch can tap.
  The spread is outside the scaled canvas and never included in PNG exports.
- **Melee/knives** on their own full-width bottom strip (lighter plane than
  gun cells), never in the gun grid.
- Style: `#0a1017` flat canvas, `#ff4655` accent wedge + left bar, Bebas Neue
  labels, Inter body, flat dark planes with clipped corners (no radial glows).

Must NOT be visible:

- No ✓ checkmarks on gun slots / stack items.
- No skin-name labels on showcase tiles (names live in the sidebar + tooltip).
- No footer bar, no LV/region badges inside the PNG beyond the header line.
- No ads, no share links, no account-selling affordances.

### Export guarantees

- PNG is **2560×1440** (1280×720 × 2), fonts + images fully loaded before
  capture (a failed image load aborts with a visible error), no menus/popovers
  in the PNG (export instance has no click handlers).
- Export button walks through phases: `PREPARING ASSETS…` →
  `RENDERING 2560 × 1440…` / `RENDERING i / n…` → `DOWNLOADED ✓`.
- Multi-page only when unknown guns overflow (≤3 pages, `1/N` indicator).

---

## Ground rules

- Canvas is **fixed 1280×720** — never make the showcase responsive.
- Tokens/credentials: request memory only, never stored, never logged, never
  committed. Repo must stay free of secrets.
- Verify before every commit: `npx tsc --noEmit && npx vitest run && npm run build`
  (112 tests). Push to `main`, redeploy in Dokploy.
- Keep `SPEC.md` §6–§8 in sync with `src/Showcase.tsx` / `src/logic.ts` /
  `src/styles.css` when UI changes.
