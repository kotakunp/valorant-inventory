# VALORANT Account Showcase Generator — Product & Technical Spec

**Status:** MVP draft
**Repo:** `/Users/kotakunp/web-projects/valorant-store`

---

## 1. Goals

- A webapp that generates a **high-resolution 16:9 landscape image** (or a small set of 2–3 images) showcasing the cosmetics a VALORANT account owns — for the account owner to attach to a listing / show to others.
- Output is **only a downloadable PNG file**. No share links, no hosted gallery pages, no stored snapshots, no ads.
- Pure webapp: **no local companion app, no browser extension**.
- Non-goals: facilitating account sales (showcase tool only), monetization/ads, storing user data between requests, Riot-approved OAuth (see §3).

## 2. Data sources

| Source | Provides | Auth |
|---|---|---|
| Unofficial Riot **client endpoints** (`pd.{shard}.a.pvp.net`, `auth.riotgames.com`) | Owned skins/variants, cards, titles, buddies; VP/RP wallet; account level; current + peak rank; equipped loadout; VP prices; Riot ID | Pasted `access token` + `entitlements JWT` (per request, never stored) |
| **[valorant-api.com](https://valorant-api.com)** (community API, free) | Static catalog: item display names, icons/images | None (server-side cache, 24h TTL) |

**Why not OAuth (RSO):** Riot's official OAuth only exposes identity (`account-v1`) and match/ranked/status APIs. **No inventory endpoint or scope exists** in the official API, and production keys require manual Riot approval. OAuth may be added later *only* as an identity step; inventory will still use the entitlements flow.

## 3. Auth model (MVP): token paste

1. User retrieves their **access token** + **entitlements JWT** (well-known community token tools) and picks their **region**.
2. Form posts `{ region, accessToken, entitlementsToken }` to `POST /api/account`.
3. Server resolves **PUUID** via `GET https://auth.riotgames.com/userinfo` (Bearer access token). Manual PUUID field as advanced fallback.
4. Tokens live in request memory only: never logged, never persisted, discarded when the response is sent.
5. Server performs all `pd.*` calls (browsers cannot: no CORS headers on Riot endpoints).

**Region → shard map:** `latam→na, br→na, na→na, eu→eu, ap→ap, kr→kr`.

## 4. Server pipeline (`POST /api/account`)

Verified against the unofficial API docs (techchrism) on 2026-09-23:

1. Resolve shard; cache client version (`valorant-api.com/v1/version` → `riotClientVersion`) + static catalog (weapons, playercards, playertitles, buddies; 24h TTL). Buddy catalog indexes both root and **level** UUIDs (entitlements return level ids).
2. `GET https://auth.riotgames.com/userinfo` → PUUID.
3. `GET /store/v1/entitlements/{puuid}/{TypeID}` for: skins `e7c63390-…`, variants `3ad1b2b2-…`, cards `3f296c07-…`, titles `de7caa6b-…`, buddies `dd3bf334-…`. Response shape (verified 2026-09-23): **flat** `{ItemTypeID, Entitlements}` — `parseEntitlements` also still accepts legacy `EntitlementsByTypes`.
4. `POST /store/v3/storefront/{puuid}` (body `{}`) → VP price map from daily offers, featured bundles (`BasePrice`), and night-market standard `Cost` (not discount). The old global `GET /store/v1/offers/` is **gone** (404 on every variant). Accessory-store items are Kingdom-Credit priced and excluded from the VP map.
5. `GET /store/v1/wallet/{puuid}` → VP / RP balances. Currency UUIDs changed: VP `85ad13f7-3d1b-5128-9eb2-7cd8ee0b5741` (legacy `…512d-6e5d…` still checked), Radianite `e59aa87c-4cbf-517a-5983-6e81511be9b7` (legacy `e046853e-…` still checked); Kingdom Credits `85ca954a-…` present but not surfaced.
6. `GET /account-xp/v1/players/{puuid}` → `Progress.Level`.
7. `GET /val/mmr/v1/players/{puuid}` → current + peak tier (fields confirmed at implementation time).
8. `GET /personalization/v3/players/{puuid}/playerloadout` → `Identity.PlayerCardID`, `Identity.PlayerTitleID`, `Identity.AccountLevel`, `Guns[].SkinID` (equipped defaults); **v2 returns 404** (kept as fallback).
9. `PUT /name-service/v2/players` body `[puuid]` → `[{ GameName, TagLine }]`.
10. Join owned IDs against static catalog → return **only owned items**: `name, icon, price, variantCount, equipped, isKnife`.

**Required headers on every `pd.*` call:** `Authorization: Bearer …`, `X-Riot-Entitlements-JWT: …`, `X-Riot-ClientPlatform` (fixed base64 JSON from docs), `X-Riot-ClientVersion` (cached).

**Errors:** any upstream non-2xx → structured `{ error }` with human-readable cause (expired token, wrong region, rate limited). No token material in errors/logs.

## 5. Item types

**MVP:** weapon skins (incl. knives), player cards, player titles, buddies.
**Phase 2:** sprays, agents/contracts, variant (chroma) tiles, real rank-tier icon assets.

## 6. Selection rules (checkboxes)

Every item is a **checkbox** (sidebar selection panels). Preview skins **do not toggle on click** — click opens a context menu (chromas, show in front, remove).

| Item | Default checked when |
|---|---|
| Skin | VP price ≥ **1775** (Premium+ / purple and above) |
| Skin, no price | **content tier ≥ Premium** (valorant-api `contentTierUuid`: Premium/Exclusive/Ultra); else unchecked |
| Card / Title / Buddy | has VP price → checked; battlepass/free → unchecked |
| Any item | **equipped** on the account → checked regardless |
| Fallback if storefront/prices/tier fail | skin with ≥ 5 levels → checked, else unchecked |

- Bulk helpers: **Select all premium**, **Clear all**, per-section select-all.
- Selection = in-memory UI state only; nothing persisted.
- **Collection value** footer = Σ VP prices of *checked* items.

**MMR parsing:** current tier = `LatestCompetitiveUpdate.TierAfterUpdate` (fallback: latest season's `CompetitiveTier`); peak tier = max `CompetitiveTier` across all seasons in `QueueSkills.competitive.SeasonalInfoBySeasonID`.

## 7. Image output spec

- **Base canvas: 1280 × 720** CSS px, exported with `pixelRatio: 2` → **2560 × 1440 PNG (1440p, 16:9)**.
- **Pagination:** center zone is **category columns** (SIDEARMS | SMGS | SHOTGUNS | RIFLES | SNIPERS | HEAVIES, each a vertical stack of gun slots in official order; unknown guns → OTHER). Always every official gun (19); knives on the full-width bottom row (not paginated). Removing the last skin of a gun keeps an **empty slot**. Density only applies if unknown guns overflow (fewest pages 1 → 2 → 3, then dense):

  | Density | Fallback chunk (flat slots) | Capacity/page |
  |---|---|---|
  | Comfort | 4×4 | 16 |
  | Standard | 5×4 | 20 |
  | Dense | 8×4 | 32 |

  - 19 official slots → Standard (1 page). Unknowns go to an OTHER column (split across pages if > 20).
  - \> 96 slots → Dense 3 pages, note `showing … / N`.
- One layout template for all pages; only the gun-cell chunk differs (header/ranks/card rail/footer/knife row repeat). Filenames `showcase-<riotid>-p1.png`…
- Export after `document.fonts.ready` + all `<img>` decoded; images served same-origin via `/img` proxy (no canvas tainting). No inventory data in any URL.

## 8. Layout spec (1280 × 720) — "official client look"

**Style tokens:** bg `#0F1923` (+ faint noise texture, red diagonal accent wedge), accent `#FF4655`, text `#ECE8E1`, muted `#8B97A0`, panels = dark glass with **diagonally clipped corners** + `1px rgba(255,255,255,.08)` border. Headline font **Bebas Neue** (self-hosted for reliable export), body **Inter**. Labels uppercase/condensed.

```
┌────────────────────────────────────────────────────────────────────┐
│ HEADER   [RIOT ID #TAG]   LV.207   ·   NA   ·  <equipped title>    │
├─────────────────────────────────────────────┬───────────────────────┤
│ COLLECTION COLUMNS                         │ PLAYER CARD           │
│ SIDEARMS│SMGS│SHOTGUNS│RIFLES│…│HEAVIES    │ tall art panel        │
│ guns stack down each category column       │ PEAK / CURRENT RANK   │
│ — stacked skins, empty = blank slot        │ VP / RP               │
│ click skin → menu (chroma/front/remove)    │ PREM:n  KNIFE:n       │
│ ── MELEE bottom row (always) ──            │ buddies +N            │
├────────────────────────────────────────────┴───────────────────────┤
│ (no footer)                                                        │
└────────────────────────────────────────────────────────────────────┘
```

- **Category columns:** one column per VAL category (guns fill top→bottom in each column), not row-major grid fill.
- **Empty slots always rendered** for official guns (and empty MELEE strip) — matches VALORANT loadout.
- **Rank medallions (MVP):** styled circular badge, tier name + tier color (real tier icons = phase 2).
- **Right rail only:** card + ranks + wallet + PREM/KNIFE + buddies under the player card; skins grid takes full remaining width (no left rail). No footer bar.
- **Knives:** always a dedicated full-width bottom strip (stacked skins); never overflow into the gun grid.
- **Stacking:** same gun's skins are layered in one cell; hover raises that skin's `z-index` + brightens. Thin light outline via multi-`drop-shadow` on the art.
- Page indicator `1/2` bottom-right when multi-page.

## 9. API surface

| Endpoint | Purpose |
|---|---|
| `POST /api/account` | `{region, accessToken, entitlementsToken, puuid?}` → joined showcase payload |
| `GET /img/:url` | Image proxy, **allowlist `media.valorant-api.com` only** |
| `GET /api/health` | Liveness |
| `GET /*` | Frontend (dev: Vite proxy → Express `:3001`) |

## 10. MVP milestones

- **M1** — this spec ✅
- **M2** — server pipeline + catalog join + caches + unit tests (entitlement parse, price defaults, pagination)
- **M3** — frontend: token form, checkbox panels, live scaled preview, density/pagination, multi-page 1440p export
- **M4** — validation: tests green, `npm run build` clean, server boots, health + live error path verified

## 11. Risks & limits

- Client endpoints are **unofficial** and may change/break without notice.
- Tokens must never be stored server-side (request-scoped memory only).
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

- **Region stays user-selected** in v1 (auto-detect via Riot Geo endpoint = later).
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

**Known residual risk → confirmed host-lock (2026-09-24):** hCaptcha Enterprise tokens minted on `localhost:5173` **and** `valorant.muur.app` are rejected by Riot (`type:"auth", captcha.hcaptcha` re-challenge). Tokens must be minted for `https://authenticate.riotgames.com/api/v1/login`. Fixes shipped:
1. **`CAPMONSTER_API_KEY`** — `server/captchaSolver.ts` solves HCaptchaTaskProxyless with `websiteURL=authenticate.riotgames.com/api/v1/login` + live `rqdata`; `startLogin` path B auto-solves when the key is set (single-request password login, no widget).
2. **Remote browser AUTO LOGIN** — `server/remoteBrowser.ts` + `src/RemoteBrowser.tsx`: headless Chromium on the VPS (nixpacks `nixPkgs` → discovered on `PATH`), JPEG frame stream + mouse/keyboard input forwarding; user logs in on Riot's real page (captcha host OK); cookie poll → `loginWithCookies` → showcase. Routes: `POST /api/browser/start`, `GET /api/browser/status|frame|result`, `POST /api/browser/input|stop`. UI opens automatically when local `/api/login/auto` fails (hosted). Session TTL 5 min, rate-limited 3/min/IP.

**Open risk:** without CapMonster and without using remote browser/cookie paste, password mode on the hosted site will keep re-challenging captcha.

## 14. Browser-cookie mode ("official flow, zero password") — recommended pure-web path

**Status:** built.

Rationale: after the reference password-flow tool (GamerNoTitle/Valora) deprecated itself "DUE TO API CHANGE" and all major auth libraries went stale, remote password login is treated as **dead**. techchrism's Cookie Reauth docs explicitly recommend cookie reauth "instead of storing the password" (ssid-only refresh stable ~1 week; all cookies ~3 weeks).

Flow:

1. User logs into **playvalorant.com in their own browser** — official page: password, hCaptcha, and 2FA handled natively; **credentials never touch the app**.
2. User copies the `ssid` cookie from devtools (Application → Cookies → `https://auth.riotgames.com`) — HttpOnly blocks page JS from reading it, which is why this is a one-value copy.
3. `POST /api/login/cookies {cookies, region}` → forgiving parser (bare value / `ssid=…` / multi-cookie string) → cookie jar → **existing `reauthForTokens`** (GET `/authorize` with cookies → parse `#access_token` from the 301 Location) → `finishLogin` (entitlements + riot-geo auto-region) → `buildShowcase`.
4. Rate-limited like other auth routes (`login:{ip}`, 5/min); cookies and tokens are request-scoped, never stored or logged; tailored errors ("log in again and copy a fresh ssid").

UX: dedicated form section with a collapsible 30-second how-to. Trade-off vs the future helper: still one manual copy, but zero install, zero password custody, and every anti-bot check is satisfied by the official flow itself.

**Automation (added):** `POST /api/login/auto` (`server/browserLogin.ts`, playwright-core + the user's installed Chrome/Edge, dedicated profile `~/.valorant-store/chrome-profile` — never the user's main browser). **Phase 0** (`server/chromeCookies.ts`, **macOS + Windows**): harvest Riot cookies from the installed Chrome cookie store — copies the `Cookies` DB (+WAL) to a temp dir. macOS: Keychain "Chrome Safe Storage" secret (PBKDF2-SHA1/`saltysalt`/1003 → AES-128-CBC, spaces-IV or embedded-IV, strips the 32-byte SHA-256(host) domain-hash prefix newer Chromium prepends). Windows: `Local State` `os_crypt.encrypted_key` (strip `DPAPI` magic) unwrapped via PowerShell `ProtectedData::Unprotect(CurrentUser)` → AES-256-GCM key for `v10` blobs; cookie DB at `<profile>/Network/Cookies` (legacy `<profile>/Cookies` fallback). `v20` app-bound blobs are skipped with an explicit message. Cookie values live only in request memory, never logged. Phase 1 reuses profile cookies invisibly (headless → `loginWithCookies`); if absent/expired, phase 2 opens a headed window at account.riotgames.com, clears stale cookies, polls ≤5 min for a fresh `ssid` (max 5 mint attempts), then runs the same reauth → `finishLogin` → `buildShowcase` pipeline. Rate-limited `login:{ip}` like the other auth routes; concurrent calls get 409; Keychain denial returns 403 with Always-Allow instructions; captcha/2FA/password are solved by the user on Riot's real page inside the window (same custody model as manual cookie mode). Manual paste remains the fallback. Implementation note: the reauth GET must send a browser-style `Accept: text/html` — `Accept: application/json` yields HTTP 406 with no redirect (no token can ever be extracted).



