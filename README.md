# VALORANT Account Showcase Generator

Generates a **2560×1440 (1440p) 16:9 PNG** of a VALORANT account's premium
collection — downloadable only, no share links, nothing stored.
See `SPEC.md` for the full product/technical specification.

## Run

```bash
npm install
npm test          # unit tests (selection defaults, pagination, parsers, RSO helpers)
npm run build     # typecheck + production bundle → dist/
npm start         # serves API + built frontend on http://localhost:3001
# or for development with hot reload:
npm run dev       # Express :3001 + Vite :5173 (proxied)
```

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

1. **Email/password + email OTP (default)** — the server performs Riot's remote authorization flow entirely in memory (auth cookies → password auth → OTP → cookie reauth → entitlements). The form embeds hCaptcha with Riot's own sitekey (extracted from their live login config — captcha is `enabled:true` for this flow) and passes the token through. Credentials are never stored or logged; the MFA session keeps only the cookie jar and expires in 5 minutes; 5 attempts/minute/IP. **Known risk:** if Riot's hCaptcha sitekey is host-locked to their domains, the widget or token may be rejected — error messages will say so, and mode 2 always works.
2. **Browser cookie (recommended)** — log in at playvalorant.com yourself (official page: captcha, 2FA, password never touches the app), copy the `ssid` cookie from devtools, paste it. The server mints tokens via Riot's own Cookie Reauth endpoint (docs-recommended over storing passwords; ~1 week stable, ~3 weeks with extra cookies) and auto-detects your region. **Zero-copy variant:** click **AUTO LOGIN (OPENS CHROME)** — if your installed Chrome is already logged into Riot, it reads the session straight from Chrome's cookie store (**macOS** Keychain prompt → *Always Allow* once; **Windows** DPAPI unwrap of Chrome's Local State key — no prompts, same logged-in Windows user only) with no window at all; otherwise it opens your Chrome in a dedicated profile — log in once (Remember me) and later clicks reuse that saved session. Manual paste stays as fallback. Cookie values stay in memory, never logged; `v20` app-bound encryption (Chrome 127+) falls back to the window flow.
3. **Paste session tokens (advanced)** — the PowerShell/lockfile method documented below.
4. **RSO "Sign in with Riot"** — code complete; activates automatically via `.env` after Riot approves your OAuth client.

## Security notes


- Never store tokens/credentials/refresh tokens; request-scoped memory only.
- `/img` proxy allowlists `media.valorant-api.com` only.
- Account selling violates Riot ToS — this tool only displays inventory.
