# INSTRUCTIONS — What we are building & what the user must see

**Repo:** valorant-store · **Spec:** `SPEC.md` (product/tech detail) · **Workflow/architecture:** `README.md`
This file = the short brief. If UI behavior and this file disagree, update both.

---

## What we are doing

A web app that turns a VALORANT account's cosmetics into a **single downloadable
2560×1440 (1440p) 16:9 PNG** that looks like the **official client's Collection /
loadout screen** — for the account owner to attach to a listing or show off.
Output is a PNG file only: no share links, no gallery, nothing stored.

The user signs in (cookie paste / remote browser / password / token paste / RSO),
the server pulls their inventory from Riot's unofficial endpoints, and the app
renders a pixel-faithful loadout preview they can curate and export.

## User journey (what happens, in order)

1. **Sign-in gate** — dark card, Riot-styled. One primary recommended path
   (browser cookie / remote login) + alternates (password, token paste, RSO).
   Errors are human-readable ("log in again and copy a fresh ssid").
2. **Workspace** loads with the account's inventory. Defaults pre-check premium
   skins (≥1775 VP / Premium+ tier) and everything equipped.
3. **Curation** — user toggles what appears; the preview updates live.
4. **Export** — "DOWNLOAD IMAGE (1440P)" (or "DOWNLOAD N IMAGES" when
   paginated). File: `showcase-<riotid>-p1.png`…

---

## What must be visible to the user

### Workspace chrome (not part of the exported PNG)

- **Top bar:** brand mark + `COLLECTION`, Riot ID `#TAG`, `LV. n`, region pill,
  `x/y skins · <density>`, **New account** button.
- **Left sidebar (controls):**
  - Selection panel: *Select all premium / Select all / Clear all*.
  - **Skins** panel: count `x/y`, *All / Premium / None*, filter box,
    gun-grouped grid of skin thumbnails — each cell shows **art, name, VP price,
    rarity-tinted border** (gold/purple/blue), equipped marker in tooltip.
  - **Cards / Titles / Buddies** panels: chip rows with checkboxes + prices.
  - Footer-fields panel (FM / PROOF optional notes). **Note:** these values are
    currently *not* wired into the showcase render — don't assume they appear
    in the PNG unless a task explicitly wires them up.
- **Preview bar:** download button, page pager `◀ 1/N ▶` when multi-page, hint
  *"Click a skin · menu to remove / front"*.
- **Preview frame:** the live 1280×720 showcase, scaled to fit.

### The showcase itself (this IS the exported image)

```
HEADER      Riot ID #TAG · LV n · region · equipped title
CENTER                                    │ RIGHT RAIL
SIDEARMS column (full height)            │ player card (tall art)
SMGS over SMGs, then SHOTGUNS            │ PEAK + CURRENT ranks
RIFLES column                            │ VP / RP wallet icons
SNIPERS over snipers, then HEAVIES       │ PREM:n  KNIFE:n
── MELEE strip (cols 2–4, ~68px) ──      │ buddies +N
```

Must be visible / true:

- **Exactly 4 category columns**; combined columns show **section titles
  mid-column** (SMGS above SMGs, SHOTGUNS above shotguns; SNIPERS then HEAVIES).
- **All 19 official guns always present**, even empty (dashed empty cell);
  empty MELEE strip always shown. Unknown guns → OTHER column.
- **Skin stacks**: multiple skins per gun layered in one cell with an overlap
  fan; **outline = the skin's rarity color** (gold `#e8c860` / purple
  `#a866ff` / blue `#7fa3c8`), hover glows + scales.
- **Click a skin in preview → context menu**: chroma variants row,
  *Show in front*, *Remove*. Click does NOT toggle selection.
- **Melee/knives** on their own full-width bottom strip, never in the gun grid.
- Style: `#0f1923` bg, `#ff4655` accent, Bebas Neue labels, Inter body,
  dark-glass panels with clipped corners.

Must NOT be visible:

- No ✓ checkmarks on gun slots / stack items.
- No skin-name labels on showcase tiles (names live in the sidebar + tooltip).
- No footer bar, no LV/region badges inside the PNG beyond the header line.
- No ads, no share links, no account-selling affordances.

### Export guarantees

- PNG is **2560×1440** (1280×720 × 2), fonts + images fully loaded before
  capture, no menus/popovers in the PNG (export instance has no click handlers).
- Multi-page only when unknown guns overflow (≤3 pages, `1/N` indicator).

---

## Ground rules

- Canvas is **fixed 1280×720** — never make the showcase responsive.
- Tokens/credentials: request memory only, never stored, never logged, never
  committed. Repo must stay free of secrets.
- Verify before every commit: `npx tsc --noEmit && npx vitest run && npm run build`
  (105 tests). Push to `main`, redeploy in Dokploy.
- Keep `SPEC.md` §6–§8 in sync with `src/Showcase.tsx` / `src/logic.ts` /
  `src/styles.css` when UI changes.
