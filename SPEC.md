# VALORANT Account Showcase Generator — Product & Technical Spec

**Status:** living document — keep §6–§8 in sync with `src/Showcase.tsx`, `src/logic.ts`, `src/styles.css` when changing the UI.
**Repo:** `/Users/kotakunp/web-projects/valorant-store`

---

## 1. Goals

- A webapp that generates a **high-resolution 16:9 landscape image** (or a small set of 2–3 images) showcasing the cosmetics a VALORANT account owns — for the account owner to attach to a listing / show to others.
- Output is a **downloadable PNG file** or a **30-day share link** (`/s/:id`) that renders the same showcase live with the hover spread (§7a). No public gallery, no listing/search of shares, no ads.
- Pure webapp: **no local companion app, no browser extension**.
- Non-goals: facilitating account sales (showcase tool only), monetization/ads, storing user data between requests, Riot-approved OAuth (see §3).

## 2. Data sources

| Source | Provides | Auth |
|---|---|---|
| Unofficial Riot **client endpoints** (`pd.{shard}.a.pvp.net`, `auth.riotgames.com`) | Owned skins, cards, titles, buddies; VP/RP wallet; account level; current + peak rank; equipped loadout; VP prices; Riot ID | Pasted **access URL** (access token; entitlements minted server-side) — per request, never stored |
| **[valorant-api.com](https://valorant-api.com)** (community API, free) | Static catalog: item display names, icons/images | None (server-side cache, 24h TTL) |

**Why not OAuth (RSO):** Riot's official OAuth only exposes identity (`account-v1`) and match/ranked/status APIs. **No inventory endpoint or scope exists** in the official API, and production keys require manual Riot approval. OAuth may be added later *only* as an identity step; inventory will still use the entitlements flow.

## 3. Auth model: access URL (one paste)

1. User opens the Riot authorize link (`ACCESS_URL_LOGIN_LINK`: `client_id=play-valorant-web-prod`, `redirect_uri=playvalorant.com/opt_in`, `response_type=token id_token`, `scope=account openid`) **in their own browser** — captcha/2FA happen on Riot's real page — and copies the full redirect URL (`playvalorant.com/opt_in#access_token=…&id_token=…`; the token is in the **fragment**, and a 404 page there is normal).
2. Form posts `{ url }` to `POST /api/account/access-url`. Region is never user-picked — there is **no server picker anywhere in the UI**; it auto-detects from the tokens (Riot Geo via `id_token`) and only falls back to `na` when detection fails. PUUID comes from the JWT `sub`.
3. Server (`server/accessUrl.ts` → `extractAccessUrl`): validates the fragment (rejects missing `#` / missing `access_token` / expired `exp` with copy-paste-friendly errors) → mints the **entitlements JWT** (`POST entitlements.auth.riotgames.com/api/token/v1`, Bearer) → `detectRegion` → `buildShowcase`.
4. Tokens live in request memory only: never logged, never persisted, discarded when the response is sent.
5. Server performs all `pd.*` calls (browsers cannot: no CORS headers on Riot endpoints).

Legacy two-token paste: `POST /api/account` still accepts `{region, accessToken, entitlementsToken, puuid?}` (the old manual panel was replaced by the access-URL panel).

**Region → shard map:** `latam→na, br→na, na→na, eu→eu, ap→ap, kr→kr`.

## 4. Server pipeline (`POST /api/account`)

Verified against the unofficial API docs (techchrism) on 2026-09-23:

1. Resolve shard; cache client version (`valorant-api.com/v1/version` → `riotClientVersion`) + static catalog (weapons, playercards, playertitles, buddies, sprays, maps, gamemodes, agents; 24h TTL). Buddy catalog indexes both root and **level** UUIDs (entitlements return level ids); spray catalog likewise indexes root + level UUIDs (accessory-store offers can reference either).
2. `GET https://auth.riotgames.com/userinfo` → PUUID.
3. `GET /store/v1/entitlements/{puuid}/{TypeID}` for: skins `e7c63390-…`, cards `3f296c07-…`, titles `de7caa6b-…`, buddies `dd3bf334-…`. Response shape (verified 2026-09-23): **flat** `{ItemTypeID, Entitlements}` — `parseEntitlements` also still accepts legacy `EntitlementsByTypes`. (Variants are **not** fetched: variant entitlements under-return; chroma lists come from the catalog instead.)
4. `POST /store/v3/storefront/{puuid}` (body `{}`) → VP price map from daily offers, featured bundles (`BasePrice`), and night-market standard `Cost` (not discount; the discount comes from `DiscountCosts[vpId]` + `DiscountPercent` — BonusStore has **no** `DiscountPrice` field). The old global `GET /store/v1/offers/` is **gone** (404 on every variant). Accessory-store items are Kingdom-Credit priced and excluded from the VP map — their KC prices + items (sprays/buddies/cards/titles) are surfaced separately by `buildStoreSection` in the Store view. **Catalog join**: the storefront price wins when present; every other skin falls back to the standard content-tier price (`tierVpPrice`: 875/1275/1775/2175/2475), so tile prices and the `VALUE n VP ~$n` totals cover the whole collection instead of only today's ~10 offers (tierless battlepass/free skins stay priceless → excluded from the total).
5. `GET /store/v1/wallet/{puuid}` → VP / RP balances. Currency UUIDs changed: VP `85ad13f7-3d1b-5128-9eb2-7cd8ee0b5741` (legacy `…512d-6e5d…` still checked), Radianite `e59aa87c-4cbf-517a-5983-6e81511be9b7` (legacy `e046853e-…` still checked); Kingdom Credits `85ca954a-…` — accessory-store prices (`kcFromCost`), surfaced with currency icon in the store strip.
6. `GET /account-xp/v1/players/{puuid}` → `Progress.Level`.
7. `GET /val/mmr/v1/players/{puuid}` → current + peak tier (fields confirmed at implementation time).
8. `GET /personalization/v3/players/{puuid}/playerloadout` → `Identity.PlayerCardID`, `Identity.PlayerTitleID`, `Identity.AccountLevel`, `Guns[].SkinID` (equipped defaults); **v2 returns 404** (kept as fallback).
9. `PUT /name-service/v2/players` body `[puuid]` → `[{ GameName, TagLine }]`.
10. Join owned IDs against static catalog → return **only owned items**: `name, icon, price, variantCount, equipped, isKnife`. Each owned skin carries **all** of its catalog chromas (`chromas`, index 0 = base; display-only — matches the client's variant picker). Chroma art resolves `displayIcon` → `fullRender` (65 variant chromas ship no `displayIcon` — e.g. Recon Phantom — and a null icon would silently render the default art).


**Required headers on every `pd.*` call:** `Authorization: Bearer …`, `X-Riot-Entitlements-JWT: …`, `X-Riot-ClientPlatform` (fixed base64 JSON from docs), `X-Riot-ClientVersion` (cached).

**Errors:** any upstream non-2xx → structured `{ error }` with human-readable cause (expired token, wrong region, rate limited). No token material in errors/logs.

## 5. Item types

**MVP:** weapon skins (incl. knives), player cards, player titles, buddies.
**Phase 2:** sprays, agents/contracts, variant (chroma) tiles, real rank-tier icon assets.

## 6. Selection rules (checkboxes)

Every item is a toggle in the **library** pane (left). Preview skins **do not toggle on click**. Hovering opens a nearby skin spread with large independent hover targets. No click or edit mode is required; variants, front ordering, and removal are available on each row.

| Item | Default checked when |
|---|---|
| Skin | VP price ≥ **1775** (Premium+ / purple and above) |
| Skin, no price | **content tier ≥ Premium** (valorant-api `contentTierUuid`: Premium/Exclusive/Ultra); else unchecked |
| Card / Title / Buddy | has VP price → checked; battlepass/free → unchecked |
| Any item | **equipped** on the account → checked regardless |
| Fallback if storefront/prices/tier fail | skin with ≥ 5 levels → checked, else unchecked |

- **Cards and titles are single-slot** (`isSingleSlot`): the showcase renders one of each, so at most one card and one title is ever checked — checking one releases the others of that kind and the preview updates instantly (equipped wins ties; the defaults from `buildSelection` and the per-section bulk buttons collapse the same way via `pickSingleSlot`). Skins and buddies stay multi-select.
- **Inspector › Quick select** (right pane): **Premium+ / Everything / Clear** apply to every item kind, plus the note "Premium+ and equipped items were picked for you." Library tabs for cards/titles/buddies carry their own **Clear** (buddies also *Select all / Paid only*). On the one-slot kinds, Everything/Premium+ pick a single item (equipped first, else the first that qualifies) instead of checking several.
- **Cards tab**: a 3-column grid of full 268×640 portraits (no hover peek needed); the selected card has an accent ring + check. **Titles tab**: radio list. **Buddies tab**: icon grid, multi-select.
- **Skins tab**: search box, *All / Selected / Equipped* segmented filter, weapon-class pill chips (scrollable with a fading edge; All · Sidearms · SMGs · Shotguns · Rifles · Snipers · Heavies · Melee), then per-gun groups with sticky headers (default-gun icon, name, `sel/total`). Each rounded tile has a rarity-tinted glow and shows art, name, VP price and an `Equipped` tag; unselected art is dimmed/desaturated, selected tiles get a red-tinted border + round red check. **Skin art is size-regulated on every surface** (library tiles, showcase stacks + empty slots, hover spread, store cards + peek): Riot's skin renders are width-normalized tight crops, so plain fit-to-box drew a small pistol as large as a rifle. `img.skin-art` + `skinArtStyle()` (`src/skinArt.tsx`) instead draw each render at the weapon's true body length as a share of its fit box (longest gun = 1, table measured off Riot's official weapon renders; unknown guns fall back to 0.78, knives to MELEE), height following the render's own aspect with the box-height cap as overflow safety only. One `--gun-len` value, one relative size everywhere.
- Selection = in-memory UI state only; nothing persisted.
- **Collection value** (inspector summary + showcase stats) = Σ VP prices of *checked* items.

**Editor workspace (never exported):** a fixed-height studio (100vh, no page scroll; below 1100px the panes stack and the page scrolls). **Design language:** modern editor chrome in the VALORANT palette (navy surfaces, off-white text, red only for the primary action and active state); Inter sentence case for UI text, Bebas Neue only for display moments (logo, hero, page titles, big numbers); 4/6/10px radii; a three-level control hierarchy — segmented **switch** (nav views, Fit/100%, skin filter) → underline **tabs** with count pills (library sections, sign-in methods) → pill **chips** (weapon classes). Icons live in `src/icons.tsx`. **Nav bar:** V mark + `COLLECTION` wordmark, segmented switch with icons **Showcase / Store** (Store hidden when the storefront is empty), VP/RP wallet pill, account block (equipped-card avatar, `Name#TAG` + `Level n · REGION`), **Switch account** icon button (confirm dialog → clears selection). **Showcase view = 3 panes:** library (left, ~340px: *Skins / Cards / Titles / Buddies* tabs with selected-count pills, tooltip `x of y selected`), stage (center: *Preview* + hint, *Fit / 100%* switch + fullscreen icon button, canvas fitted to both axes in a rounded frame on a dotted backdrop), inspector (right, ~300px: **Download image** / *Download N images* primary button with download icon and export phases (§7), `PNG · 2560 × 1440` (`· N pages`), pager `‹ i/N ›` when multi-page, Summary (lead *Collection value* in large display digits + VP and `≈ $n USD`, then a 4-up stat row: skins x/y, premium, melee, buddies), Quick select, Profile (current card + title, *Change* jumps to that library tab), Variants (per selected skin: thumbnail, name, chroma swatches; hovering/focusing a swatch opens a display-only enlarged **variant peek** left of the inspector with skin + chroma name, *Shown* / *Click to show* and `i / n`)). **Store view:** page header (`STORE` + one-line description), then the store panel full-width: left-aligned section headers — `DAILY OFFERS` with a live `HH:MM:SS` rotation countdown pill (1s tick), then `NIGHT MARKET` (accent `−N%` discount tag on the art + struck standard + discounted price) and `ACCESSORIES` rows when active — card rows with name + currency-icon price (`VP` for skins, `KC` for accessories), `OWNED` corner badge, scrollable when a row overflows; cards are rounded with a soft hover lift; every skin card shows its **rarity** — soft tinted outline + art glow + official tier-gem icon (`contentTierIcon`) + small label (`ULTRA`/`PREMIUM`/`SELECT`/`STANDARD` via `rarityColor`/`rarityLabel`). Card names wrap to two lines (a third when needed, never ellipsized) with bars kept flush. Each card opens an enlarged **peek** on hover or tap (natural aspect ratio, anchored beside the card, clamped to the viewport); click / tap / `Enter` **selects** one card at a time (accent ring, `aria-pressed`); 180ms leave-grace, tap-away, `Escape` and resize clear it, scroll re-anchors it (`StorePeek` in `StorePanel.tsx`). Parsed from the storefront already fetched for pricing (`store` on the payload). There is no recent-matches feature.

**MMR parsing:** current tier = `LatestCompetitiveUpdate.TierAfterUpdate` (fallback: latest season's `CompetitiveTier`); peak tier = max `CompetitiveTier` across all seasons in `QueueSkills.competitive.SeasonalInfoBySeasonID`.

## 7. Image output spec

- **Base canvas: 1280 × 720** CSS px, exported with `pixelRatio: 2` → **2560 × 1440 PNG (1440p, 16:9)**.
- **Pagination:** center zone is **exactly 4 category columns** — SIDEARMS | SMGS·SHOTGUNS | RIFLES | SNIPERS·HEAVIES. Combined columns use **section titles mid-column** (SMGS on top of SMGs then SHOTGUNS above shotguns; SNIPERS then HEAVIES) — not a single combined title. Guns stack top→bottom in official order; unknown guns → OTHER. Always every official gun (19); knives on the full-width bottom row (not paginated). Removing the last skin of a gun keeps an **empty slot**. Density only applies if unknown guns overflow (fewest pages 1 → 2 → 3, then dense):

  | Density | Fallback chunk (flat slots) | Capacity/page |
  |---|---|---|
  | Comfort | 4×4 | 16 |
  | Standard | 5×4 | 20 |
  | Dense | 8×4 | 32 |

  - 19 official slots → Standard (1 page). Unknowns go to an OTHER column (split across pages if > 20).
  - \> 96 slots → Dense 3 pages, note `showing … / N`.
- One layout template for all pages; only the gun-cell chunk differs (header/ranks/card rail/footer/knife row repeat). Filenames `showcase-<riotid>-p1.png`…
- Export after `document.fonts.ready` + all `<img>` decoded; images served same-origin via `/img` proxy (no canvas tainting). No inventory data in any URL. Any image that fails to load **aborts the export with a visible error** (fail loudly, never silently skip artwork).
- **Export feedback phases** on the button: `Preparing assets…` → `Rendering 2560 × 1440…` (single page) or `Rendering i of n…` (multi-page) → `Downloaded` (clears after ~1.5s).

## 7a. Share links

- **Create:** *Create share link* (secondary button under *Download image*, shown when `GET /api/share/config` → `enabled`). The client sends `{ proof, picks, preview }` to `POST /api/share`:
  - `proof` = `payload.shareProof`, an HMAC-SHA256 (`SHARE_SECRET`) signed, deflated manifest attached by `buildShowcase` to every payload: Riot ID, region, level, rank tiers, wallet, `pricesAvailable`, and the owned item ids with price/equipped/equipped-chroma. No PUUID, no tokens. Valid **24h** (`MANIFEST_TTL_MS`); expired/forged proofs → 401 "sign in again".
  - `picks` = selected skin ids + chosen chroma, `bringToFront` (only for shared skins), the one card/title the showcase renders (equipped first), selected buddy ids. Max 600 skins / 400 buddies.
  - `preview` = optional 1200×675 JPEG data URL of export page 1 (`toJpeg`, quality steps 0.82 → 0.5 until < 512 KB). Validated by magic bytes and size; failures to capture never block the link.
- **Snapshot:** every pick must be in the manifest (else 400). Items are rebuilt from the public catalog (`skinItemFromCatalog`, shared with sign-in) so names/art can't be injected. Stored payload = only shown items, `puuid: ""`, `store: null`, rank badges re-resolved, plus `chromaSel`, `bringToFront`, `createdAt`, `expiresAt` (**30 days**).
- **Storage:** Postgres via `DATABASE_URL` (`showcase_shares(id text pk, data jsonb, preview bytea, created_at, expires_at)`, created on boot; hourly `delete where expires_at <= now()`; reads filter expired rows). Without `DATABASE_URL`: dev uses an in-memory store, production disables sharing. Ids: 8 chars from a 57-symbol alphabet without look-alikes (`newShareId`, ~46 bits). Rate limit `share:{ip}` 10 per 10 min. `/api/share` accepts JSON up to 1 MB; all other routes stay at 32 KB.
- **Owner UI:** the link is copied on creation and shown in a mono URL box with a copy icon button and `Anyone with the link can view · expires <date>`. Any later change to selection/variants/order marks it outdated (dimmed box + "Your selection changed…" + *New link*). Switching account clears it.
- **Visitor page** (`/s/:id`, `SharedView.tsx`; `main.tsx` routes by path): nav = logo (links home) + owner avatar/Riot ID/`Level n · REGION` + red *Make your own →*; stage bar *Collection* + hint *Hover a weapon to see every skin and variant*, pager when multi-page, fullscreen; fitted showcase (max 1.25×) with hover spread and variant switching (local only, not saved); footer `Shared <date> · link expires <date>` + unofficial notice. Missing/expired → *Link unavailable* card with *Make your own*. Under 1100px the nav wraps above the 16:9 stage.
- **Link previews:** `GET /s/:id` serves `index.html` with `<title>`, description and Open Graph/Twitter tags injected server-side (`og:title` = `Name#TAG · VALORANT collection`, description `n skins · n VP. Hover any weapon…`, `og:image` = `/s/:id/preview.jpg` 1200×675 with `summary_large_image`, `robots noindex`). Origin from `PUBLIC_URL`, else the request host. All values HTML-escaped.
- **Privacy:** a share exposes exactly what the PNG shows (Riot ID + tag, level, region, ranks, wallet, chosen items) to anyone with the URL. Links are unlisted, not revocable before expiry.

## 8. Layout spec (1280 × 720) — "official client look"

**Style tokens:** canvas `#0F1923` with two hard-edged diagonal bands (accent 4.5% / off-white 2.5% — no radial glows), accent `#FF4655` (top-right wedge + solid 4px left bar), text `#ECE8E1`, muted `#8B97A0`, tiles = **sharp** rectangles, `rgba(236,232,225,.035)` fill + `1px rgba(236,232,225,.08)` border. Filled gun tiles get a 2px bottom edge + low bottom tint in the front skin's rarity color. Headline font **Bebas Neue** (self-hosted for reliable export), body **Inter** 400/600/700. Labels uppercase/condensed.

```
┌────────────────────────────────────────────────────────────────────┐
│ (no header — grid starts at the top edge)                          │
├─────────────────────────────────────────────┬───────────────────────┤
│ COLLECTION COLUMNS                         │ PLAYER CARD (dominant)│
│ SIDEARMS│SMGS│SHOTGUNS │RIFLES│SNIPERS│HEAVIES │ tall art panel       │
│ col1 spans full height (incl. melee band)  │ STATS grid            │
│                                             │ RANK medallions       │
│ section titles sit on their own groups     │  PEAK + CURRENT       │
│ hover stack → spread (outside the canvas)    │ VP / RP wallet row    │
│ ── MELEE (cols 2–4, ~108px, lighter) ──    │                       │
│                                             │                       │
├────────────────────────────────────────────┴───────────────────────┤
│ (no footer)                                                        │
└────────────────────────────────────────────────────────────────────┘
```

- **Category columns:** exactly 4 columns (SMGs+shotguns merged; snipers+heavies merged) — guns fill top→bottom, not row-major grid fill.
- **Sidearms column** spans full center height including the melee band; melee strip sits only under columns 2–4 (~108px tall — uses the space freed by dropping the header), rendered on a **lighter** plane than gun cells.
- **Two-axis stack:** front skin centered in the cell; the rest recede diagonally — direction is deterministic per column (left half cascades `down-right`, right half `down-left` via `stackDirectionForColumn`). Per-skin step (`stackSteps`) shrinks as the stack grows and the whole cascade is bounded by `STACK_SPREAD` (x 0.3 / y 0.24 of the cell) so **no stack ever escapes its cell**; back layers scale down slightly for depth. Order is front-first via `orderStack`: manual "show in front" → equipped → tier score (price / content tier / level) → stable original order. Transforms are inline per item; hovering opens an unscaled spread outside the canvas. Artwork remains stable inside the canvas.
- **Hover spread:** pointer entry or keyboard focus on a weapon reveals all its selected skins beside the stack. Each row has a fixed large target, name, artwork, variants, front and remove actions (read-only shares omit front/remove: `Showcase hoverable` without `onRemoveSkin`, and `HoverSkins` drops buttons whose callback is absent). Only artwork scales on hover, never the hit target. A 180ms leave delay bridges the gap to the spread. Long lists scroll; position is clamped within the viewport. Escape, resize, or scrolling outside the spread dismisses it. Touch can tap the same target. No separate inspector or click-to-edit flow. Export instances render no hover targets or portals.

- **Empty slots always rendered** for official guns (and empty MELEE strip) — the official default-weapon render at low opacity (`defaultIcons`), neutral bottom edge, no `+`/labels; matches VALORANT loadout.
- **No header.** **Stats** sit in the right rail directly under the player card: a 4-column grid of big Bebas numbers with small caps labels — `SKINS` (guns), `PREMIUM`, `MELEE`, `BUDDIES` — and a full-width `VALUE n VP ~$n` row (list-price value via `collectionValue`, USD at 1,000 VP = $9.99; hidden when 0 / priceless).
- **Right rail:** player card dominates (official 268:640 art ratio, title + Riot ID + level over the art) → stats grid → side-by-side **rank medallions** (PEAK + CURRENT) → wallet as one horizontal VP/RP row. Skins grid takes full remaining width. No footer bar.
- **Knives:** always a dedicated full-width bottom strip (each knife its own cell); never overflow into the gun grid.
- **Stacking:** same gun's skins are layered in one cell; hover reveals individually hoverable skins in the spread. Art outline is **white** (multi-`drop-shadow` on `.sc-stack-art`); rarity shows on the tile's bottom edge via per-cell `--rarity`; hovering a spread row highlights its artwork without shifting targets.
- Page indicator `1/2` bottom-right when multi-page.

## 9. API surface

| Endpoint | Purpose |
|---|---|
| `POST /api/account` | `{region, accessToken, entitlementsToken, puuid?}` → joined showcase payload (legacy) |
| `POST /api/account/access-url` | `{url, region?}` → extract fragment token, mint entitlements, auto region/PUUID → showcase payload |
| `GET /img/:url` | Image proxy, **allowlist `media.valorant-api.com` only** |
| `GET /api/health` | Liveness |
| `GET /api/share/config` | `{enabled}`: whether share storage is configured |
| `POST /api/share` | `{proof, picks, preview?}` → `{id, path, expiresAt}` (§7a) |
| `GET /api/share/:id` | Stored snapshot `{showcase, chromaSel, bringToFront, createdAt, expiresAt}`; 404 when missing/expired |
| `GET /s/:id` · `GET /s/:id/preview.jpg` | Shared page with injected Open Graph tags · stored JPEG preview |
| `GET /*` | Frontend (dev: Vite proxy → Express `:3001`) |

## 10. MVP milestones

- **M1** — this spec ✅
- **M2** — server pipeline + catalog join + caches + unit tests (entitlement parse, price defaults, pagination)
- **M3** — frontend: token form, checkbox panels, live scaled preview, density/pagination, multi-page 1440p export
- **M4** — validation: tests green, `npm run build` clean, server boots, health + live error path verified

## 11. Risks & limits

- Client endpoints are **unofficial** and may change/break without notice.
- Tokens must never be stored server-side (request-scoped memory only). Share links store only the trimmed snapshot (no PUUID, no tokens).
- Account selling violates Riot ToS — this tool only *displays* inventory.
- Riot policy asks any player-facing product to register on the Developer Portal even when using unofficial endpoints — do before public launch.

## 12. RSO mode ("Sign in with Riot") — scaffold, awaiting client_id

**Status:** built and tested; disabled until `RSO_CLIENT_ID`/`RSO_REDIRECT_URI` are set (token-paste remains the default path).

Flow (verified against OAuth Client Documentation + valapidocs):

1. Frontend saves random `state` (+ chosen region) in `sessionStorage`, redirects to `https://auth.riotgames.com/authorize?client_id=…&redirect_uri=…&response_type=code&scope=openid+offline_access&state=…`.
2. Riot redirects to `/rso/callback?code=…&state=…` → frontend validates `state` (CSRF) → `POST /api/rso/exchange {code, region}`.
3. Server: code exchange at `auth.riotgames.com/oauth2/token` → access token → PUUID (`userinfo`, fallback `id_token.sub`) → `POST entitlements.auth.riotgames.com/api/token/v1` → entitlements JWT.
4. Feeds into `buildShowcase` — **identical pipeline** to token-paste mode.

Design decisions:

- **Region is auto-detected** via the Riot Geo endpoint (id_token → `affinities.live`) for every flow: access URL, cookie, password, auto, and RSO (all carry an id_token). The UI has **no region/server picker at all** — the old dropdown inside the access-URL panel was removed; every flow falls back to `na` when detection fails.
- **Refresh tokens requested (`offline_access`) but never stored** — persistent sessions = stored account access; revisit deliberately post-launch.
- **Entitlements step is the spike test:** if Riot refuses third-party RSO tokens at `entitlements.*`/`pd.*`, surface the explicit 403 message (already implemented) and fall back to helper-app option.
- Env config via `.env` (see `.env.example`); missing config ⇒ `/api/rso/config` returns `configured:false` ⇒ button renders "COMING SOON".

## 13. Remote password login mode ("unofficial automation")

**Status:** built; captcha/anti-bot variance is the known accepted risk (§11).

Flow (server-side only; verified against rogama25 `HCaptcha.md` + PyRiotAuth + live probes 2026-09-23):

1. `POST auth.riotgames.com/api/v1/authorization` → seed cookies (`client_id: riot-client`; re-send once if `asid` missing).
2. `POST authenticate.riotgames.com/api/v1/login` (full body with null socials) → Enterprise `{sitekey, rqdata}` + cookies (`authenticator.sid`, `tdid`, `__cflb`). Server stores the **cookie jar** under a single-use `captchaSessionId` so the later PUT shares those cookies with this `rqdata`.
3. First submit without captcha → returns `{captchaRequired, sitekey, rqdata, captchaSessionId}`; password is **not** sent yet.
4. UI renders hCaptcha with `data=rqdata`, solves, resubmits `{username, password, captcha, captchaSessionId}`.
5. `PUT authenticate.riotgames.com/api/v1/login` `{type:"auth", riot_identity:{username, password, captcha:"hcaptcha <token>", language, remember:false, state:null, campaign:null}}` → `success.login_token` **or** new captcha challenge (400/`invalid_request`) **or** multifactor **or** error.
6. `POST auth.riotgames.com/api/v1/login-token` `{authentication_type:"RiotAuth", code_verifier:"", login_token, persist_login:false}` → `ssid` on the same jar.
7. `POST …/authorization` with `ssid` → inline `access_token` (or cookie reauth fallback) → entitlements → `buildShowcase`.

MFA: `PUT` `{type:"multifactor", code, rememberDevice:true}` (invalid code = HTTP 200 + `error:"invalid_code"`).

Safeguards:

- Per-IP rate limit: 5 login attempts / minute (both endpoints).
- Captcha sessions: single-use, TTL 5 min, cap 100 — jar + rqdata never leave the server.
- MFA sessions hold **cookie jar + masked email only — never credentials**; TTL 5 min, cap 200.
- Nothing credential-related is logged; `AuthFlowError.details` carries only sitekey/rqdata/captchaSessionId/cookie **names**.
- Non-JSON auth response ⇒ explicit anti-bot error instead of a confusing failure.
- UI: email/password → captcha → email OTP box → same showcase; token-paste demoted to advanced fallback.

**Captcha phase (shipped, fixed 2026-09-23):** Riot returns bare `auth_failure` when captcha is missing (the word "captcha" never appears). The form mounts hCaptcha on `auth_failure`/`captchaRequired`/`sitekey`, fetches live `rqdata` + `captchaSessionId`, renders with Enterprise `data`, and sends `{captcha, captchaSessionId}`. Prior bugs: (1) widget only mounted on `/captcha/i`; (2) password was PUT to the **dead** `auth.riotgames.com/authorization` endpoint (always `auth_failure`); (3) captcha challenge cookies were not bound to the PUT — fixed via single-use `captchaSessionId`.

**Known residual risk → confirmed host-lock (2026-09-24):** hCaptcha Enterprise tokens minted on `localhost:5173` **and** `valorant.muur.app` are rejected by Riot (`type:"auth", captcha.hcaptcha` re-challenge). Tokens must be minted for `https://authenticate.riotgames.com/api/v1/login`. Fix shipped:
1. **`CAPMONSTER_API_KEY`** — `server/captchaSolver.ts` solves HCaptchaTaskProxyless with `websiteURL=authenticate.riotgames.com/api/v1/login` + live `rqdata`; `startLogin` path B auto-solves when the key is set (single-request password login, no widget).

**Remote-browser mode was removed** (was: streamed headless Chromium with forwarded mouse/keyboard). It exposed one globally addressable session slot — any unauthenticated caller could watch another user's Riot sign-in, type into it, and take their payload. On the hosted VPS, password mode is therefore unusable without `CAPMONSTER_API_KEY`; use the access URL, AUTO LOGIN (local Chrome), or cookie paste instead.

**Open risk:** without CapMonster and without the access URL / cookie paste, password mode on the hosted site will keep re-challenging captcha.

## 14. Browser-cookie mode ("official flow, zero password") — recommended pure-web path

**Status:** built.

Rationale: after the reference password-flow tool (GamerNoTitle/Valora) deprecated itself "DUE TO API CHANGE" and all major auth libraries went stale, remote password login is treated as **dead**. techchrism's Cookie Reauth docs explicitly recommend cookie reauth "instead of storing the password" (ssid-only refresh stable ~1 week; all cookies ~3 weeks).

Flow:

1. User logs into **playvalorant.com in their own browser** — official page: password, hCaptcha, and 2FA handled natively; **credentials never touch the app**.
2. User copies the `ssid` cookie from devtools (Application → Cookies → `https://auth.riotgames.com`) — HttpOnly blocks page JS from reading it, which is why this is a one-value copy.
3. `POST /api/login/cookies {cookies, region}` → forgiving parser (bare value / `ssid=…` / multi-cookie string) → cookie jar → **existing `reauthForTokens`** (GET `/authorize` with cookies → parse `#access_token` from the 301 Location) → `finishLogin` (entitlements + riot-geo auto-region) → `buildShowcase`.
4. Rate-limited like other auth routes (`login:{ip}`, 5/min); cookies and tokens are request-scoped, never stored or logged; tailored errors ("log in again and copy a fresh ssid").

UX: the **access-URL paste** is the primary gate path — an always-visible 4-step guide whose first step is a one-click **Riot sign-in link** (`ACCESS_URL_LOGIN_LINK`, styled as an accent button), then the full-URL textarea and a *Load collection* submit; the guide notes that the server auto-detects the region (no server picker exists anywhere). Everything else collapses under **"Other sign-in methods ▾"**: ssid cookie paste (4-step collapsible **"Where do I find this?"** how-to, human-readable failure copy + **Try again** button on cookie errors, *Load with cookie* submit), password/MFA, Chrome AUTO LOGIN, and RSO (only implemented methods shown; no wording implying Riot OAuth is available before `RSO_CLIENT_ID` is configured). Trade-off vs the future helper: still one manual copy, but zero install, zero password custody, and every anti-bot check is satisfied by the official flow itself.

**Automation (added):** `POST /api/login/auto` (`server/browserLogin.ts`, playwright-core + the user's installed Chrome/Edge, dedicated profile `~/.valorant-store/chrome-profile` — never the user's main browser). **Phase 0** (`server/chromeCookies.ts`, **macOS + Windows**): harvest Riot cookies from the installed Chrome cookie store — copies the `Cookies` DB (+WAL) to a temp dir. macOS: Keychain "Chrome Safe Storage" secret (PBKDF2-SHA1/`saltysalt`/1003 → AES-128-CBC, spaces-IV or embedded-IV, strips the 32-byte SHA-256(host) domain-hash prefix newer Chromium prepends). Windows: `Local State` `os_crypt.encrypted_key` (strip `DPAPI` magic) unwrapped via PowerShell `ProtectedData::Unprotect(CurrentUser)` → AES-256-GCM key for `v10` blobs; cookie DB at `<profile>/Network/Cookies` (legacy `<profile>/Cookies` fallback). `v20` app-bound blobs are skipped with an explicit message. Cookie values live only in request memory, never logged. Phase 1 reuses profile cookies invisibly (headless → `loginWithCookies`); if absent/expired, phase 2 opens a headed window at account.riotgames.com, clears stale cookies, polls ≤5 min for a fresh `ssid` (max 5 mint attempts), then runs the same reauth → `finishLogin` → `buildShowcase` pipeline. Rate-limited `login:{ip}` like the other auth routes; concurrent calls get 409; Keychain denial returns 403 with Always-Allow instructions; captcha/2FA/password are solved by the user on Riot's real page inside the window (same custody model as manual cookie mode). Manual paste remains the fallback. Implementation note: the reauth GET must send a browser-style `Accept: text/html` — `Accept: application/json` yields HTTP 406 with no redirect (no token can ever be extracted).



