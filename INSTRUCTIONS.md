# INSTRUCTIONS — What we are building & what the user must see

**Repo:** valorant-store · **Spec:** `SPEC.md` (product/tech detail) · **Workflow/architecture:** `README.md`
This file = the short brief. If UI behavior and this file disagree, update both.

---

## What we are doing

A web app that turns a VALORANT account's cosmetics into a **single downloadable
2560×1440 (1440p) 16:9 PNG** that looks like the **official client's Collection /
loadout screen** — for the account owner to attach to a listing or show off.
Output is a PNG file, or a share link that shows the same showcase (with hover
browsing) to anyone who opens it for 30 days. There is no public gallery.

The user signs in (cookie paste / password / access URL / RSO),
the server pulls their inventory from Riot's unofficial endpoints, and the app
renders a pixel-faithful loadout preview they can curate and export.

## User journey (what happens, in order)

1. **Sign-in gate** — split screen: a typographic hero on the left
   ("YOUR ARSENAL. ONE IMAGE." + *Sign in / Curate / Export* step cards) and
   the sign-in panel on the right. Primary path is two numbered steps: **1**
   *Open Riot sign-in ↗* (Riot's real page, captcha + 2FA), **2** paste the
   whole `…opt_in#access_token=…` address-bar URL, then *Load collection*. Region +
   PUUID are **auto-detected** — there is **no server picker anywhere**.
   **Other sign-in methods** expands to tabs: *Cookie* (ssid paste + "Where do
   I find this?"), *Password*, *Chrome* (+ RSO button when configured).
   Cookie failures show human-readable copy + **Try again**.
2. **Workspace** loads with the account's inventory in a fixed-height,
   3-pane studio (library · stage · inspector). Defaults pre-check premium
   skins (≥1775 VP / Premium+ tier) and everything equipped — noted in the
   inspector.
3. **Curation** — user toggles what appears in the library (search,
   All/Selected/Equipped filter, weapon-class chips); the preview updates live.
4. **Export** — *Download image* (or *Download N images* when paginated),
   showing phases: `Preparing assets…` → `Rendering 2560 × 1440…` /
   `Rendering i of n…` → `Downloaded`. File: `showcase-<riotid>-p1.png`…

---

## What must be visible to the user

### Workspace chrome (not part of the exported PNG)

Fixed to the viewport (no page scroll) on desktop; under 1100px the panes
stack (stage → inspector → library) and the page scrolls.

Design language: modern editor chrome with the VALORANT palette (navy
surfaces, off-white text, red reserved for the primary action and active
state). UI text is Inter in sentence case; Bebas Neue appears only in display
moments (logo, hero, store/page titles, big numbers). Rounded corners (4/6/10
px tokens), no heavy borders. Controls follow a strict three-level hierarchy:
**segmented switch** (nav views, Fit/100%, skin filter) → **underline tabs
with count pills** (library sections, sign-in methods) → **pill chips**
(weapon classes).

- **Nav bar:** V mark + `COLLECTION` wordmark, a segmented switch with icons
  **Showcase / Store** (Store only when the storefront has offers), VP/RP
  wallet pill, account block (equipped-card avatar, `Name#TAG` over
  `Level n · REGION`) and a **Switch account** icon button (confirm dialog
  clears the selection).
- **Library (left pane):** underline tabs *Skins / Cards / Titles / Buddies*,
  each with a pill showing the selected count (tooltip `x of y selected`).
  - Skins: search, *All / Selected / Equipped* segmented filter, weapon-class
    pill chips (scrollable, fading edge), per-gun groups with sticky headers
    (default-gun icon + `NAME ── sel/total`), 2-column rounded tiles with a
    rarity-tinted glow: art + name + VP price + `Equipped` tag. Unselected art
    is dimmed/desaturated; selected = red-tinted border + round red check.
  - Cards: 3-column grid of full portraits (single-select, accent ring).
    Titles: radio list. Buddies: icon grid (multi-select, *Select all / Paid
    only / Clear*). Cards and titles are **single-select** — picking one
    releases the others and the showcase updates instantly.
  - **Skin art sizing is regulated everywhere** (showcase stacks + empty
    slots, library tiles, hover spread, store cards + peek): each gun skin
    renders at the weapon's true body length as a share of its box (longest
    gun = 1), so a small pistol is never drawn as large as a rifle
    (`src/skinArt.tsx` → `img.skin-art`).
- **Stage (center):** bar with *Preview* + hint *"Hover a weapon to reorder,
  recolor or remove its skins"*, a *Fit / 100%* switch and a fullscreen icon
  button; the live 1280×720 showcase is fitted to both axes in a rounded
  frame on a dotted backdrop (editor-only — export geometry never
  changes).
- **Inspector (right pane):** primary **Download image** button (download
  icon; *Download N images* when paginated) with export phases,
  `PNG · 2560 × 1440` (`· N pages`), pager `‹ i/N ›` when multi-page;
  **Summary** (lead *Collection value* in large display digits + `VP`,
  `≈ $n USD`, then a 4-up stat row: skins x/y, premium, melee, buddies);
  **Quick select** *Premium+ / Everything / Clear* + the auto-pick
  note; **Profile** (current card + title, *Change* jumps to that library
  tab); **Variants** (per selected skin: thumbnail, name, chroma swatches).
  Hovering or focusing a swatch opens an enlarged **variant peek** left of
  the inspector (skin name, chroma name, *Shown* / *Click to show*, `i / n`);
  display-only, never takes the pointer.
- **Store view** (nav switch, editor-only, never exported): page header
  (`STORE` + one-line description), left-aligned section headers —
  `DAILY OFFERS` + live `HH:MM:SS` countdown pill, `NIGHT MARKET`
  (accent `−N%` tag, struck standard + discounted price), `ACCESSORIES`
  (Kingdom-Credit prices). Rounded skin cards show a soft rarity-tinted outline and art glow + tier gem
  + rarity label, currency-icon price and `OWNED` badge. Names wrap (never
  ellipsized mid-name). Hover opens an enlarged peek; click / tap / `Enter`
  selects one card at a time (accent ring, `aria-pressed`); `Escape` or a
  click away clears it.
- There is **no recent-matches strip** (removed, along with its server calls).

### The showcase itself (this IS the exported image)

```
(no header — the grid starts at the top edge)
CENTER                                    │ RIGHT RAIL
SIDEARMS column (full height)            │ player card (tall art, dominant)
SMGS over SMGs, then SHOTGUNS            │ STATS: SKINS │ PREMIUM │ MELEE │ BUDDIES
RIFLES column                            │        VALUE n VP ~$n (full row)
SNIPERS over snipers, then HEAVIES       │ RANK: PEAK + CURRENT medallions
── MELEE strip (cols 2–4, ~108px) ──     │ VP / RP wallet (one row)
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
  original. **Outline = white** (tight multi-`drop-shadow`; rarity lives on
  the tile's bottom edge), hover opens an unscaled spread with individually hoverable skins.
- **Hover a weapon stack → nearby skin spread**: no click required. Every skin
  has its own large, stationary row; hover highlights the row and enlarges its
  artwork without moving its pointer target. Long stacks scroll. A short leave
  delay bridges the gap between stack and spread. Variants, front ordering,
  and removal are available directly on each row; no inspector or edit mode.
  Keyboard focus also opens the spread, Escape dismisses it; touch can tap.
  The spread is outside the scaled canvas and never included in PNG exports.
- **Melee/knives** on their own full-width bottom strip (lighter plane than
  gun cells), never in the gun grid.
- Style (in-client look): `#0f1923` canvas with two hard-edged diagonal
  bands, `#ff4655` top-right wedge + solid 4px left bar, Bebas Neue labels,
  Inter body, **sharp** tiles (no clipped corners, no radial glows). Filled gun
  tiles carry the front skin's rarity color as a 2px bottom edge + low tint.

Must NOT be visible:

- No ✓ checkmarks on gun slots / stack items.
- No skin-name labels on showcase tiles (names live in the library + hover spread).
- No footer bar, no LV/region badges inside the PNG beyond the player card.
- No ads, no account-selling affordances, no links inside the PNG.

### Share links

- **Create share link** (secondary button under *Download image*; only shown
  when the server has storage) snapshots exactly what the preview shows:
  selected skins with their chosen variants and stack order, the one card and
  title, and selected buddies. The link (`/s/<8-char id>`) is copied
  automatically and shown in a box with a copy button and its expiry date.
  Changing the selection afterwards marks the link as outdated, with a
  *New link* button.
- Links live **30 days** in Postgres (`DATABASE_URL`), then are deleted.
  Everything the PNG shows is public to anyone with the link (Riot ID + tag,
  level, region, ranks, VP/RP wallet). No PUUID, tokens or store offers are
  stored.
- **Visitor page** (`/s/:id`): nav with the owner's avatar, Riot ID and level,
  plus a red *Make your own* button; the same fitted showcase with the hover
  spread and variant switching but **no** *To front* / *Remove* buttons;
  footer with shared and expiry dates. Expired or unknown links show a
  *Link unavailable* card.
- Pasting a link into Discord/X/iMessage shows a 1200×675 JPEG preview of the
  showcase plus `Name#TAG · VALORANT collection` and `n skins · n VP`.
- Ownership is enforced server-side: the showcase payload carries a signed
  proof (`SHARE_SECRET`, valid 24h), and the server rejects any shared item
  that isn't in it. Names and art come from the public catalog, not the browser.

### Export guarantees

- PNG is **2560×1440** (1280×720 × 2), fonts + images fully loaded before
  capture (a failed image load aborts with a visible error), no menus/popovers
  in the PNG (export instance has no click handlers).
- Export button walks through phases: `Preparing assets…` →
  `Rendering 2560 × 1440…` / `Rendering i of n…` → `Downloaded`.
- Multi-page only when unknown guns overflow (≤3 pages, `1/N` indicator).

---

## Ground rules

- Canvas is **fixed 1280×720** — never make the showcase responsive.
- Tokens/credentials: request memory only, never stored, never logged, never
  committed. Repo must stay free of secrets. Share links store only the
  trimmed showcase snapshot (no PUUID, no tokens).
- Verify before every commit: `npx tsc --noEmit && npx vitest run && npm run build`
  (158 tests). Push to `main`, redeploy in Dokploy.
- Keep `SPEC.md` §6–§8 in sync with `src/Showcase.tsx` / `src/logic.ts` /
  `src/styles.css` when UI changes.
