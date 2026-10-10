# VALORANT Account Showcase Generator

Generates a **2560×1440 (1440p) 16:9 PNG** of a VALORANT account's premium
collection, downloadable as a PNG or shared as a 30-day link with a live, hoverable view.
See `SPEC.md` for the full product/technical specification (§6–§8 = UI/layout source of truth).

## Run

```bash
npm install
npm test          # vitest (selection defaults, pagination, stack layout, auth parsers, share links) — expect 158 tests green
npm run build     # tsc --noEmit + production bundle → dist/
npm start         # serves API + built frontend on http://localhost:3001
# or for development with hot reload:
npm run dev       # Express :3001 + Vite :5173 (proxied)
```

## Verification loop (before every commit)

```bash
npx tsc --noEmit && npx vitest run && npm run build
```

All three must pass (158 tests). Then `git add … && git commit && git push` to `main`.

## Architecture

```
src/                      # React frontend (Vite + TS)
  App.tsx                 # workspace state, studio shell (nav, 3 panes), preview + export Showcases, zoom
  SignIn.tsx              # sign-in gate: access URL (primary) + cookie / password / Chrome / RSO
  Library.tsx             # left pane: skins / cards / titles / buddies selection
  Inspector.tsx           # right pane: download, share link, summary, quick select, profile, variants
  SharedView.tsx          # read-only /s/:id page (main.tsx routes there by path)
  useFitScale.ts          # fits the 1280×720 canvas into a stage (studio + shared page)
  Showcase.tsx            # the showcase renderer (layout, two-axis stack, hover spread, right rail, knife row)
  logic.ts                # selection rules, rarityColor, WEAPON_CATEGORIES, paginate(), stack layout (stackLayers/orderStack)
  logic.test.ts           # UI-logic tests
  styles.css              # all styles; fixed 1280×720 `.sc-root` canvas
  types.ts                # SkinItem, ShowcasePayload, …
  rso.ts, captcha.ts, StorePanel.tsx (Store view)
server/                   # Express (tsx, no build step)
  index.ts                # routes + /img proxy + /s/:id (Open Graph tags) + static dist/ in production
  share.ts                # share snapshots: ownership check, Postgres/in-memory store, OG meta, preview validation
  shareManifest.ts        # signed ownership proof attached to every showcase payload
  valorant.ts             # Riot pipeline: entitlements/storefront/wallet/MMR → buildShowcase
  riotAuth.ts, rso.ts     # token-paste / RSO auth
  browserLogin.ts, chromeCookies.ts, captchaSolver.ts
  *.test.ts               # vitest suite
SPEC.md                   # product + technical spec (UI sections must stay in sync)
```

### UI invariants (easy to break — read before touching `Showcase.tsx`)

- Export canvas is **fixed 1280×720** — `.sc-root` must never become responsive; preview zoom (Fit/100%/Fullscreen) only scales the editor preview.
- Hovering a preview stack opens its skins in a nearby scrollable spread with separate, stable hover targets (variants, front ordering, and removal remain available), they do not toggle selection; toggling lives in the library pane.
- `paginate(allSkins, selection)` always emits all 19 official gun slots + the knife row; empty guns render as empty cells (dimmed default-weapon render from `payload.defaultIcons`, no border).
- Stacks are two-axis: front-first order (`orderStack`: manual front → equipped → tier score → stable) with inline `translate/scale` per layer (`stackLayers`), cascade direction per column (`stackDirectionForColumn`), spread bounded by `STACK_SPREAD` — never CSS-fan transforms.
- Rarity outline color comes from `--rarity` set per stack item (`rarityColor()` in `logic.ts`).
- Images load through `/img` proxy (allowlist `media.valorant-api.com`) so the PNG export doesn't taint the canvas; failed image loads abort the export.

## Deploy

- Hosted via **Dokploy** with **Nixpacks** (`nixpacks.toml`: nodejs_20); push to `main`, then redeploy in Dokploy.
- Production: `npm start` → `NODE_ENV=production tsx server/index.ts` on **:3001**.
- Config via `.env` (see `.env.example`): `RSO_*`, `PORT`, `CAPMONSTER_API_KEY`, `DATABASE_URL`, `SHARE_SECRET`, `PUBLIC_URL`.
- **Share links** need `DATABASE_URL` (any Postgres, e.g. Supabase; use the session pooler URL). The
  `showcase_shares` table is created on startup; expired rows are deleted hourly. Without
  `DATABASE_URL`, production hides the share button; `npm run dev` keeps links in memory.
  Set `SHARE_SECRET` (32+ random chars) so share proofs survive restarts and redeploys.
  Set `PUBLIC_URL` (e.g. `https://valorant.muur.app`) so link previews use the public origin.

## Getting tokens (current mode — no app approval needed)

With VALORANT running on Windows, paste into PowerShell:

```powershell
$lock  = (Get-Content "$env:LOCALAPPDATA\Riot Games\Riot Client\Config\lockfile" -Raw).Trim()
$parts = $lock -split ':'
$b64   = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("riot:$($parts[3])"))
$j     = (& curl.exe -sk -H "Authorization: Basic $b64" "https://127.0.0.1:$($parts[2])/entitlements/v1/token") | ConvertFrom-Json
"ACCESS TOKEN:"; $j.accessToken
"ENTITLEMENTS:"; $j.token          # yes: response field "token" = entitlements JWT
"PUUID:";        $j.subject
```

Paste the three values into the form. Tokens are held in request memory only.

## RSO mode ("Sign in with Riot") — awaiting your Riot approval

1. Apply at `developer.riotgames.com` (production key → RSO client).
2. When Riot emails the `client_id`, copy `.env.example` → `.env` and set:
   - `RSO_CLIENT_ID`
   - `RSO_REDIRECT_URI` (must exactly match a redirect URI whitelisted in your Riot app; dev default `http://localhost:5173/rso/callback`)
   - `RSO_CLIENT_SECRET` (only if issued)
3. Restart the server — the button enables automatically.
4. **Spike test once configured:** sign in and confirm Riot accepts the RSO
   access token at the entitlements endpoint (`entitlements.auth.riotgames.com`)
   and the `pd.*` inventory endpoints. Inventory access for third-party RSO
   clients is *undocumented* — confirm it with Riot during app review.

OAuth flows implemented: authorize redirect (with CSRF `state`), code exchange,
userinfo/`id_token` → PUUID, entitlements JWT, then the exact same showcase
pipeline as token-paste mode. Refresh tokens (`offline_access`) are requested
but deliberately **not stored** in v1.

## Sign-in modes

1. **Access URL (recommended)** — open the Riot sign-in link in your own browser (captcha/2FA happen on Riot's real page), then copy the entire redirect URL (`playvalorant.com/opt_in#access_token=…` — the `#…` fragment matters) and paste it. Server mints entitlements, auto-detects region/PUUID (no region picker anywhere); the token is used once in request memory, never stored.
2. **Email/password + email OTP** — server performs Riot's 2026 authenticate flow in memory (challenge → captcha → password PUT → OTP → entitlements). Credentials never stored. **Hosted caveat:** hCaptcha Enterprise tokens minted in our widget are host-locked to `authenticate.riotgames.com` and Riot rejects tokens from `valorant.muur.app` / `localhost`. Fix options: set `CAPMONSTER_API_KEY` (server solves for the correct origin) or use the access URL / AUTO LOGIN / cookie paste.
3. **Browser cookie** — log in at playvalorant.com yourself, copy the `ssid` cookie, paste it. Server mints tokens via Cookie Reauth (~1 week stable). **AUTO LOGIN:** desktop harvests your installed Chrome session (macOS Keychain / Windows DPAPI) or opens a local Chrome window. On the hosted VPS there is no interactive fallback — use the access URL or cookie paste there.
4. **Paste session tokens (advanced)** — PowerShell/lockfile method (below).
5. **RSO "Sign in with Riot"** — activates via `.env` after Riot approves the OAuth client.

## Security notes


- Never store tokens/credentials/refresh tokens; request-scoped memory only.
- `/img` proxy allowlists `media.valorant-api.com` only.
- Account selling violates Riot ToS — this tool only displays inventory.
