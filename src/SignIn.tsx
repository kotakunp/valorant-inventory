import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Region, ShowcasePayload } from "./types";
import { ACCESS_URL_LOGIN_LINK } from "./types";
import { makeState, parseCallback, RSO_STATE_KEY, RSO_REGION_KEY } from "./rso";
import { SITEKEY, loadHcaptcha, widgetToken, resetCaptcha, renderCaptcha, fetchCaptchaChallenge } from "./captcha";

type LoadKind = "cookies" | "password" | "mfa" | "auto" | "url" | "rso";
type AltMethod = "cookie" | "password" | "chrome";

/** Normalize a pasted cookie string for the API (strip Cookie: header, trim). */
function normalizeCookiePaste(raw: string): string {
  return raw.trim().replace(/^cookie:\s*/i, "");
}

/** Light client pre-check — structured pastes without ssid never hit the server. */
function cookiePasteLooksValid(raw: string): boolean {
  const s = normalizeCookiePaste(raw);
  if (!s) return false;
  if (/ssid\s*=/i.test(s)) return true;
  // Bare ssid (may contain '=' padding) — no other cookie-name= prefix.
  if (!s.includes(";") && !/^[a-z_][a-z0-9_-]*\s*=/i.test(s)) return true;
  return false;
}

/** Plain-language hint for common cookie-login failures (§20). */
function humanizeCookieError(msg: string): string {
  const m = msg.toLowerCase();
  if (/expired|invalid|unauthorized|forbidden|401|ssid|cookie/.test(m)) {
    return (
      "That cookie didn't work — it may have expired or been copied incompletely. " +
      "Copy a fresh ssid (the full Cookie header) from auth.riotgames.com and try again."
    );
  }
  return msg;
}

export function SignIn({ onLoaded }: { onLoaded: (payload: ShowcasePayload) => void }) {
  const [region] = useState<Region>("na");
  const [accessUrl, setAccessUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<LoadKind | null>(null);
  const [rso, setRso] = useState<{ configured: boolean } | null>(null);
  const [altOpen, setAltOpen] = useState(false);
  const [alt, setAlt] = useState<AltMethod>("cookie");
  const [creds, setCreds] = useState({ email: "", password: "", otp: "" });
  const [auth, setAuth] = useState<{ mode: "idle" | "mfa"; sessionId: string; email: string }>({
    mode: "idle",
    sessionId: "",
    email: "",
  });
  const [captchaStatus, setCaptchaStatus] = useState<"loading" | "ready" | "error">("loading");
  const [captchaNeeded, setCaptchaNeeded] = useState(false);
  const [captchaSolver, setCaptchaSolver] = useState(false);
  const [captchaChallenge, setCaptchaChallenge] = useState<{
    sitekey: string;
    rqdata: string | null;
    captchaSessionId?: string;
    solver?: boolean;
  }>({ sitekey: SITEKEY, rqdata: null });
  const [cookieInput, setCookieInput] = useState("");
  const [cookieFailed, setCookieFailed] = useState(false);
  const captchaDivRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);

  /**
   * Load guard: several sign-in paths can be in flight at once (access URL,
   * RSO callback, password, MFA, cookie, AUTO LOGIN). A slow earlier response
   * must not silently replace the account the user is now looking at.
   */
  const loadSeqRef = useRef(0);
  const beginLoad = () => ++loadSeqRef.current;
  const applyIfCurrent = (token: number, json: ShowcasePayload) => {
    if (loadSeqRef.current !== token) return false;
    onLoaded(json);
    return true;
  };

  useEffect(() => {
    fetch("/api/rso/config")
      .then((r) => r.json())
      .then((j) => setRso({ configured: !!j.configured }))
      .catch(() => setRso({ configured: false }));

    const parsed = parseCallback(window.location.search, sessionStorage.getItem(RSO_STATE_KEY));
    if (parsed.kind !== "none") {
      sessionStorage.removeItem(RSO_STATE_KEY);
      window.history.replaceState(null, "", "/");
      if (parsed.kind === "error") setError(parsed.message);
      else void exchangeRsoCode(parsed.code);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!captchaNeeded) return; // widget only loads when Riot challenges us
    let dead = false;
    void (async () => {
      // Prefer the challenge that came with the login error (bound captchaSessionId).
      let challenge = captchaChallenge;
      if (!challenge.captchaSessionId || !challenge.sitekey || challenge.sitekey === SITEKEY) {
        const fetched = await fetchCaptchaChallenge();
        if (dead) return;
        challenge = fetched;
        setCaptchaChallenge(fetched);
        setCaptchaSolver(!!fetched.solver);
      }
      // Without a server-side solver, widget tokens are host-rejected — don't render a doomed captcha.
      if (!challenge.solver && !captchaSolver) {
        setCaptchaStatus("error");
        setError(
          "Riot rejects captcha solved on this site (host-lock). Use the access URL, Chrome login, or paste the ssid cookie. " +
            "To enable password mode, set CAPMONSTER_API_KEY in the server env."
        );
        return;
      }
      try {
        await loadHcaptcha();
        if (dead || !captchaDivRef.current || captchaDivRef.current.hasChildNodes()) return;
        widgetIdRef.current = renderCaptcha(captchaDivRef.current, {
          sitekey: challenge.sitekey,
          rqdata: challenge.rqdata,
        });
        setCaptchaStatus("ready");
      } catch {
        if (!dead) setCaptchaStatus("error");
      }
    })();
    return () => {
      dead = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [captchaNeeded, captchaSolver, captchaChallenge.captchaSessionId, captchaChallenge.rqdata, captchaChallenge.sitekey]);

  async function fetchAccessUrl(e: FormEvent) {
    e.preventDefault();
    const loadToken = beginLoad();
    const url = accessUrl.trim();
    if (!url) {
      setError("Paste the full access URL from the Riot sign-in redirect.");
      return;
    }
    if (!url.includes("#")) {
      setError("That URL has no #fragment — copy the ENTIRE address bar URL from the redirect page (Riot puts the token after the #).");
      return;
    }
    if (!url.includes("access_token=")) {
      setError("No access_token in that URL — open the Riot sign-in link in step 1, log in, then paste the redirect URL.");
      return;
    }
    setError(null);
    setLoading("url");
    try {
      const res = await fetch("/api/account/access-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const json = (await res.json().catch(() => ({}))) as ShowcasePayload & { error?: string };
      if (!res.ok || json.error) {
        setError(json.error ?? `Request failed (${res.status})`);
        return;
      }
      applyIfCurrent(loadToken, json);
    } catch {
      setError("Network error — is the server running on port 3001?");
    } finally {
      setLoading(null);
    }
  }

  async function exchangeRsoCode(code: string) {
    const loadToken = beginLoad();
    setLoading("rso");
    setError(null);
    try {
      const res = await fetch("/api/rso/exchange", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, region: sessionStorage.getItem(RSO_REGION_KEY) || region }),
      });
      const json = (await res.json().catch(() => ({}))) as ShowcasePayload & { error?: string };
      if (!res.ok || json.error) {
        setError(json.error ?? `Riot sign-in failed (${res.status})`);
        return;
      }
      applyIfCurrent(loadToken, json);
    } catch {
      setError("Network error during Riot sign-in.");
    } finally {
      sessionStorage.removeItem(RSO_REGION_KEY);
      setLoading(null);
    }
  }

  async function startRso() {
    setError(null);
    try {
      const state = makeState();
      sessionStorage.setItem(RSO_STATE_KEY, state);
      sessionStorage.setItem(RSO_REGION_KEY, region);
      const res = await fetch(`/api/rso/config?state=${encodeURIComponent(state)}`);
      const json = await res.json();
      if (!json.configured || !json.url) {
        setError("Riot sign-in is not configured yet — set RSO_CLIENT_ID / RSO_REDIRECT_URI once Riot approves the app.");
        return;
      }
      window.location.assign(json.url);
    } catch {
      setError("Could not start Riot sign-in.");
    }
  }

  async function submitLogin(e: FormEvent) {
    e.preventDefault();
    const loadToken = beginLoad();
    if (auth.mode === "mfa") {
      await submitMfaOtp(loadToken);
      return;
    }
    const token = widgetToken(widgetIdRef.current);
    if (captchaNeeded && !captchaSolver) {
      // Host-locked captcha: Riot rejects tokens minted for our origin, so
      // password mode can't complete here — point at the working paths.
      setError(
        "Password mode needs a server-side captcha solver on the hosted site (set CAPMONSTER_API_KEY), " +
          "or use the access URL / Chrome login / cookie paste."
      );
      return;
    }

    setError(null);
    setLoading("password");
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: creds.email,
          password: creds.password,
          region,
          captcha: token || undefined,
          captchaSessionId: captchaChallenge.captchaSessionId || undefined,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (json?.mfaRequired) {
        setAuth({ mode: "mfa", sessionId: json.sessionId, email: json.email ?? "" });
        setCreds((c) => ({ ...c, password: "", otp: "" }));
        return;
      }
      if (!res.ok || json?.error) {
        resetCaptcha(widgetIdRef.current);
        widgetIdRef.current = null;
        const msg: string = json?.error ?? `Sign-in failed (${res.status})`;
        // Riot signals captcha need via auth_failure + captchaRequired/sitekey — never via the word "captcha".
        if (json?.captchaRequired || json?.sitekey || /captcha/i.test(msg) || /auth_failure/i.test(msg)) {
          setCaptchaNeeded(true);
          if (typeof json?.solver === "boolean") setCaptchaSolver(json.solver);
          if (typeof json?.sitekey === "string" && json.sitekey) {
            setCaptchaChallenge({
              sitekey: json.sitekey,
              rqdata: json.rqdata ?? null,
              captchaSessionId: typeof json.captchaSessionId === "string" ? json.captchaSessionId : undefined,
            });
            // Force a re-render of the widget for the new rqdata/session
            setCaptchaStatus("loading");
            if (captchaDivRef.current) captchaDivRef.current.innerHTML = "";
          }
        }
        setError(msg);
        return;
      }
      applyIfCurrent(loadToken, json as ShowcasePayload);
      setCreds((c) => ({ ...c, password: "", otp: "" }));
    } catch {
      setError("Network error during sign-in.");
    } finally {
      setLoading(null);
    }
  }

  /**
   * OTP submit. `token` lets the delegating `submitLogin` pass its own load id
   * so the whole MFA round-trip stays one logical load; direct form/button
   * invocations start (and therefore own) the newest one.
   */
  async function submitMfaOtp(token: number = beginLoad()) {
    if (!creds.otp.trim()) {
      setError("Enter the verification code from your email.");
      return;
    }
    setError(null);
    setLoading("mfa");
    try {
      const res = await fetch("/api/login/mfa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: auth.sessionId, code: creds.otp, region }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json?.error) {
        setError(json?.error ?? `Verification failed (${res.status})`);
        return;
      }
      applyIfCurrent(token, json as ShowcasePayload);
      setAuth({ mode: "idle", sessionId: "", email: "" });
      setCreds((c) => ({ ...c, password: "", otp: "" }));
    } catch {
      setError("Network error during verification.");
    } finally {
      setLoading(null);
    }
  }

  async function submitAuto() {
    const loadToken = beginLoad();
    setError(null);
    setLoading("auto");
    try {
      const res = await fetch("/api/login/auto", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ region }),
      });
      const json = (await res.json().catch(() => ({}))) as ShowcasePayload & { error?: string };
      if (!res.ok || json.error) {
        setError(json.error ?? `Chrome login failed (${res.status})`);
        return;
      }
      applyIfCurrent(loadToken, json as ShowcasePayload);
    } catch {
      setError("Network error during Chrome login.");
    } finally {
      setLoading(null);
    }
  }

  async function submitCookies(e?: { preventDefault(): void }) {
    const loadToken = beginLoad();
    e?.preventDefault();
    const pasted = normalizeCookiePaste(cookieInput);
    if (!pasted) {
      setError("Paste your ssid cookie value first (see “Where do I find this?”).");
      return;
    }
    if (!cookiePasteLooksValid(pasted)) {
      setError(
        "That paste doesn't include an ssid cookie. Copy the ssid value (or the full Cookie header) from auth.riotgames.com — see “Where do I find this?”."
      );
      return;
    }
    setError(null);
    setCookieFailed(false);
    setLoading("cookies");
    try {
      const res = await fetch("/api/login/cookies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cookies: pasted, region }),
      });
      const json = (await res.json().catch(() => ({}))) as ShowcasePayload & { error?: string };
      if (!res.ok || json.error) {
        setCookieFailed(true);
        setError(json.error ?? `Cookie connect failed (${res.status})`);
        return;
      }
      applyIfCurrent(loadToken, json);
      setCookieInput("");
    } catch {
      setCookieFailed(true);
      setError("Network error during cookie connect.");
    } finally {
      setLoading(null);
    }
  }

  const busy = loading !== null;

  return (
    <div className="gate">
      <section className="gate-hero" aria-hidden="true">
        <div className="gate-hero-top">
          <span className="brand-mark" />
          <span className="gate-hero-brand">Collection</span>
        </div>
        <div className="gate-hero-copy">
          <span className="gate-eyebrow">VALORANT loadout showcase</span>
          <h1 className="gate-hero-title">
            YOUR ARSENAL.
            <br />
            <em>ONE IMAGE.</em>
          </h1>
          <p className="gate-hero-sub">
            Turn every skin, card and rank on your account into a single 2560 × 1440 PNG that looks
            like the in-game Collection screen.
          </p>
        </div>
        <ol className="gate-hero-steps">
          <li><b>1</b><span>Sign in</span><small>Riot&apos;s own page</small></li>
          <li><b>2</b><span>Curate</span><small>Pick what to show</small></li>
          <li><b>3</b><span>Export</span><small>1440p PNG</small></li>
        </ol>
        <div className="gate-hero-wordmark">VALORANT</div>
      </section>

      <section className="gate-panel">
        <div className="gate-panel-inner">
          <header className="gate-head">
            <span className="gate-eyebrow">Sign in</span>
            <h2>Load your collection</h2>
          </header>

          {error && (
            <div className="error" role="alert">
              <span>{cookieFailed ? humanizeCookieError(error) : error}</span>
              {cookieFailed && (
                <button type="button" className="btn-sm" onClick={() => void submitCookies()}>
                  Try again
                </button>
              )}
            </div>
          )}

          <form className="gate-steps" onSubmit={fetchAccessUrl}>
            <div className="gate-step">
              <span className="gate-step-num">1</span>
              <div className="gate-step-body">
                <div className="gate-step-title">Sign in on Riot&apos;s page</div>
                <p className="gate-step-hint">Captcha and 2FA happen on Riot&apos;s site. You never type your password here.</p>
                <a className="btn btn-outline" href={ACCESS_URL_LOGIN_LINK} target="_blank" rel="noreferrer noopener">
                  Open Riot sign-in <span aria-hidden="true">↗</span>
                </a>
              </div>
            </div>
            <div className="gate-step">
              <span className="gate-step-num">2</span>
              <div className="gate-step-body">
                <label className="gate-step-title" htmlFor="access-url">Paste the address bar URL</label>
                <p className="gate-step-hint">
                  You&apos;ll land on <strong>playvalorant.com/opt_in</strong>. A blank or 404 page is normal. Copy
                  the whole URL, including everything after <code>#</code>. It stays valid for about an hour.
                </p>
                <textarea
                  id="access-url"
                  rows={3}
                  spellCheck={false}
                  placeholder="https://playvalorant.com/opt_in#access_token=…"
                  value={accessUrl}
                  onChange={(e) => setAccessUrl(e.target.value)}
                />
              </div>
            </div>
            <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
              {loading === "url" ? "Loading…" : "Load collection"}
            </button>
            <p className="gate-fine">Region is detected automatically. Tokens live in request memory only and are never stored.</p>
          </form>

          <div className={`gate-alt${altOpen ? " is-open" : ""}`}>
            <button
              type="button"
              className="gate-alt-toggle"
              aria-expanded={altOpen}
              onClick={() => setAltOpen((o) => !o)}
            >
              <span>Other sign-in methods</span>
              <span className="gate-alt-caret" aria-hidden="true" />
            </button>

            {altOpen && (
              <div className="gate-alt-body">
                <div className="tabs tabs--sm" role="tablist" aria-label="Other sign-in methods">
                  {(
                    [
                      ["cookie", "Cookie"],
                      ["password", "Password"],
                      ["chrome", "Chrome"],
                    ] as const
                  ).map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      role="tab"
                      aria-selected={alt === id}
                      className={alt === id ? "on" : ""}
                      onClick={() => setAlt(id)}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {alt === "cookie" && (
                  <form className="gate-alt-pane" onSubmit={submitCookies}>
                    <label className="field-label" htmlFor="ssid">ssid cookie</label>
                    <input
                      id="ssid"
                      type="text"
                      autoComplete="off"
                      spellCheck={false}
                      placeholder="ssid=…; asid=…; tdid=…"
                      value={cookieInput}
                      onChange={(e) => {
                        setCookieInput(e.target.value);
                        if (cookieFailed) {
                          setCookieFailed(false);
                          setError(null);
                        }
                      }}
                    />
                    <p className="gate-step-hint">Paste the full Cookie header. The ssid value alone often isn&apos;t enough.</p>
                    <details className="gate-howto">
                      <summary>Where do I find this?</summary>
                      <ol>
                        <li>
                          Log in at <strong>playvalorant.com</strong> or <strong>account.riotgames.com</strong> with{" "}
                          <em>Remember me</em> ticked.
                        </li>
                        <li>
                          Press <strong>F12</strong>, open the <strong>Network</strong> tab, then load{" "}
                          <a href="https://auth.riotgames.com/" target="_blank" rel="noreferrer noopener">
                            <code>auth.riotgames.com</code>
                          </a>
                          . An &quot;error occurred&quot; page is normal.
                        </li>
                        <li>
                          Click the <code>auth.riotgames.com</code> request, open <strong>Request Headers</strong> and copy
                          the whole <strong>cookie</strong> value.
                        </li>
                        <li>
                          Paste it above. The Application tab (Cookies → <strong>.riotgames.com</strong>) works too;
                          Firefox may truncate long values.
                        </li>
                      </ol>
                    </details>
                    <button className="btn btn-secondary btn-block" type="submit" disabled={busy}>
                      {loading === "cookies" ? "Loading…" : "Load with cookie"}
                    </button>
                  </form>
                )}

                {alt === "password" && (
                  <div className="gate-alt-pane">
                    <form onSubmit={submitLogin}>
                      {auth.mode !== "mfa" && (
                        <>
                          <label className="field-label" htmlFor="riot-user">Riot username or email</label>
                          <input
                            id="riot-user"
                            type="text"
                            autoComplete="username"
                            value={creds.email}
                            onChange={(e) => setCreds({ ...creds, email: e.target.value })}
                          />
                          <label className="field-label" htmlFor="riot-pass">Password</label>
                          <input
                            id="riot-pass"
                            type="password"
                            autoComplete="current-password"
                            value={creds.password}
                            onChange={(e) => setCreds({ ...creds, password: e.target.value })}
                          />
                        </>
                      )}
                      <div
                        className={"captcha-box" + (!captchaNeeded || auth.mode === "mfa" ? " captcha-hidden" : "")}
                        ref={captchaDivRef}
                      >
                        {captchaStatus === "error" && (
                          <span className="gate-step-hint gate-warn">
                            Riot rejects captchas solved on this site. Use the access URL or cookie instead.
                          </span>
                        )}
                      </div>
                      {auth.mode !== "mfa" && (
                        <>
                          <p className="gate-step-hint">Hosted deployments need a server-side captcha solver for this method.</p>
                          <button
                            className="btn btn-secondary btn-block"
                            type="submit"
                            disabled={
                              busy ||
                              (captchaNeeded && !captchaSolver && captchaStatus !== "ready" && captchaStatus !== "error")
                            }
                          >
                            {loading === "password" ? "Signing in…" : "Sign in"}
                          </button>
                        </>
                      )}
                    </form>
                    {auth.mode === "mfa" && (
                      <div className="mfa-box">
                        <p className="gate-step-hint">
                          We sent a verification code
                          {auth.email ? (<> to <strong>{auth.email}</strong></>) : " to your email"}.
                        </p>
                        <label className="field-label" htmlFor="riot-otp">Verification code</label>
                        <input
                          id="riot-otp"
                          type="text"
                          inputMode="numeric"
                          autoComplete="one-time-code"
                          placeholder="123456"
                          value={creds.otp}
                          onChange={(e) => setCreds({ ...creds, otp: e.target.value })}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              void submitMfaOtp();
                            }
                          }}
                        />
                        <div className="mfa-actions">
                          <button className="btn btn-secondary" type="button" onClick={() => void submitMfaOtp()} disabled={busy}>
                            {loading === "mfa" ? "Verifying…" : "Verify"}
                          </button>
                          <button
                            className="btn-sm"
                            type="button"
                            onClick={() => {
                              setAuth({ mode: "idle", sessionId: "", email: "" });
                              setCreds((c) => ({ ...c, otp: "" }));
                            }}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {alt === "chrome" && (
                  <div className="gate-alt-pane">
                    <p className="gate-step-hint">
                      Local only. Reuses the Riot session from your Chrome profile (macOS asks once for Keychain
                      access), or opens a Chrome window so you can log in once.
                    </p>
                    <button className="btn btn-secondary btn-block" type="button" onClick={submitAuto} disabled={busy}>
                      {loading === "auto" ? "Check the Chrome window…" : "Log in with Chrome"}
                    </button>
                  </div>
                )}

                {rso?.configured && (
                  <button type="button" className="btn btn-secondary btn-block gate-rso" onClick={startRso} disabled={busy}>
                    {loading === "rso" ? "Working…" : "Sign in with Riot (OAuth)"}
                  </button>
                )}
              </div>
            )}
          </div>

          <p className="gate-foot">
            Unofficial tool. Not affiliated with Riot Games. The exported image contains no links. Never share
            session tokens with anyone.
          </p>
        </div>
      </section>
    </div>
  );
}
