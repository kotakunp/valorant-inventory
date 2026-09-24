import { useMemo, useState, useEffect, useRef, type FormEvent, type CSSProperties } from "react";
import { toPng } from "html-to-image";
import type { ChromaSelection, ItemKind, Region, Selection, ShowcasePayload } from "./types";
import { selKey } from "./types";
import { buildSelection, paginate, rarityColor } from "./logic";
import type { AnyItem } from "./logic";
import { makeState, parseCallback, RSO_STATE_KEY, RSO_REGION_KEY } from "./rso";
import { SITEKEY, loadHcaptcha, widgetToken, resetCaptcha, renderCaptcha, fetchCaptchaChallenge } from "./captcha";
import { Showcase, CANVAS_W, CANVAS_H } from "./Showcase";
import { RemoteBrowserPanel } from "./RemoteBrowser";

const REGIONS: Region[] = ["na", "eu", "ap", "kr", "latam", "br"];
const fmt = (n: number) => n.toLocaleString("en-US");

const qs = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
const IS_REMOTE_POPUP = qs.get("remote") === "1";
const POPUP_REGION = ((qs.get("region") as Region) || "na") satisfies Region;
const REMOTE_CREDS_KEY = "valorant-remote-creds";

/** Stash email/password for the remote popup (sessionStorage — same-origin tab copy only). */
function stashRemoteCreds(email: string, password: string): void {
  if (!email || !password || typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(REMOTE_CREDS_KEY, JSON.stringify({ username: email, password }));
  } catch {
    /* private mode */
  }
}

function takeRemoteCreds(): { username: string; password: string } | undefined {
  if (typeof sessionStorage === "undefined") return undefined;
  try {
    const raw = sessionStorage.getItem(REMOTE_CREDS_KEY);
    if (!raw) return undefined;
    sessionStorage.removeItem(REMOTE_CREDS_KEY);
    const parsed = JSON.parse(raw) as { username?: string; password?: string };
    if (parsed.username && parsed.password) {
      return { username: parsed.username, password: parsed.password };
    }
  } catch {
    /* ignore */
  }
  return undefined;
}

type LoadKind = "cookies" | "password" | "mfa" | "auto" | "tokens" | "rso";

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

export default function App() {
  const [form, setForm] = useState({ region: "na" as Region, accessToken: "", entitlementsToken: "", puuid: "" });
  const [data, setData] = useState<ShowcasePayload | null>(null);
  const [selection, setSelection] = useState<Selection>({});
  const [chromaSel, setChromaSel] = useState<ChromaSelection>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<LoadKind | null>(null);
  const [fm, setFm] = useState({ on: false, text: "" });
  const [proof, setProof] = useState({ on: false, text: "" });
  const [page, setPage] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [rso, setRso] = useState<{ configured: boolean } | null>(null);
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
  }>({
    sitekey: SITEKEY,
    rqdata: null,
  });
  const [cookieInput, setCookieInput] = useState("");
  const [remoteOpen, setRemoteOpen] = useState(false);
  const [remoteCreds, setRemoteCreds] = useState<{ username: string; password: string } | undefined>(() =>
    IS_REMOTE_POPUP ? takeRemoteCreds() : undefined
  );
  const remoteWinRef = useRef<Window | null>(null);
  const captchaDivRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);

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

    // Popup child → opener: deliver showcase when remote login finishes.
    const onMsg = (ev: MessageEvent) => {
      if (ev.origin !== window.location.origin) return;
      if (ev.data?.type === "valorant-showcase" && ev.data.payload) {
        applyShowcase(ev.data.payload as ShowcasePayload);
        setRemoteOpen(false);
        setError(null);
      }
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pages = useMemo(() => {
    if (!data) return null;
    return paginate(data.skins.filter((s) => selection[selKey("skin", s.id)]));
  }, [data, selection]);

  const footerOpts = { fm: fm.on, fmText: fm.text, proof: proof.on, proofText: proof.text };
  const img = (u: string | null) => (u ? `/img/${encodeURIComponent(u)}` : undefined);

  function defaultChromaMap(payload: ShowcasePayload): ChromaSelection {
    const out: ChromaSelection = {};
    for (const s of payload.skins) {
      const id = s.defaultChromaId ?? s.chromas[0]?.id;
      if (id) out[s.id] = id;
    }
    return out;
  }

  function applyData(json: ShowcasePayload) {
    setData(json);
    setSelection(buildSelection(json));
    setChromaSel(defaultChromaMap(json));
    setPage(0);
  }

  useEffect(() => {
    if (data || !captchaNeeded) return; // widget only loads when Riot challenges us
    let dead = false;
    void (async () => {
      // Prefer the challenge that came with the login error (bound captchaSessionId).
      // Only fetch a fresh one if the server did not include sitekey/session.
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
          "Riot rejects captcha solved on this site (host-lock). Use AUTO LOGIN (remote browser) or paste the ssid cookie. " +
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
  }, [data, captchaNeeded, captchaSolver, captchaChallenge.captchaSessionId, captchaChallenge.rqdata, captchaChallenge.sitekey]);

  async function fetchAccount(e: FormEvent) {
    e.preventDefault();
    if (!form.accessToken.trim() || !form.entitlementsToken.trim()) {
      setError("Both the access token and the entitlements token are required for manual mode.");
      return;
    }
    setError(null);
    setLoading("tokens");
    try {
      const res = await fetch("/api/account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          region: form.region,
          accessToken: form.accessToken,
          entitlementsToken: form.entitlementsToken,
          puuid: form.puuid.trim() || undefined,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as ShowcasePayload & { error?: string };
      if (!res.ok || json.error) {
        setError(json.error ?? `Request failed (${res.status})`);
        return;
      }
      setData(json);
      setSelection(buildSelection(json));
      setChromaSel(defaultChromaMap(json));
      setPage(0);
    } catch {
      setError("Network error — is the server running on port 3001?");
    } finally {
      setLoading(null);
    }
  }

  const toggle = (kind: ItemKind, id: string) =>
    setSelection((s) => ({ ...s, [selKey(kind, id)]: !s[selKey(kind, id)] }));

  const pickChroma = (skinId: string, chromaId: string) =>
    setChromaSel((s) => ({ ...s, [skinId]: chromaId }));

  const setSection = (kind: ItemKind, mode: "all" | "none" | "premium") => {
    if (!data) return;
    const items: AnyItem[] = { skin: data.skins, card: data.cards, title: data.titles, buddy: data.buddies }[kind];
    setSelection((s) => {
      const next = { ...s };
      for (const it of items) {
        next[selKey(kind, it.id)] =
          mode === "all"
            ? true
            : mode === "none"
              ? false
              : kind === "skin"
                ? (it.price ?? -1) >= 1775
                : it.price != null;
      }
      return next;
    });
  };

  const allSections = (mode: "all" | "none" | "premium") =>
    (["skin", "card", "title", "buddy"] as ItemKind[]).forEach((k) => setSection(k, mode));

  async function exportImages() {
    if (!data || !pages) return;
    setExporting(true);
    setError(null);
    try {
      await document.fonts.ready;
      const nodes = Array.from(document.querySelectorAll<HTMLElement>("[data-export-page]"));
      const imgs = Array.from(document.querySelectorAll<HTMLImageElement>("[data-export-page] img"));
      await Promise.all(
        imgs.map((i) =>
          i.complete && i.naturalWidth > 0
            ? Promise.resolve()
            : new Promise<void>((r) => {
                i.addEventListener("load", () => r(), { once: true });
                i.addEventListener("error", () => r(), { once: true });
              })
        )
      );
      const slug = `${data.gameName}_${data.tagLine}`.replace(/[^\w-]+/g, "") || "account";
      for (let i = 0; i < nodes.length; i++) {
        const url = await toPng(nodes[i], { pixelRatio: 2, backgroundColor: "#0f1923", width: CANVAS_W, height: CANVAS_H });
        const a = document.createElement("a");
        a.href = url;
        a.download = `showcase-${slug}-p${i + 1}.png`;
        a.click();
        await new Promise((r) => setTimeout(r, 400));
      }
    } catch (e) {
      setError(`Export failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setExporting(false);
    }
  }

  async function exchangeRsoCode(code: string) {
    setLoading("rso");
    setError(null);
    try {
      const res = await fetch("/api/rso/exchange", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, region: sessionStorage.getItem(RSO_REGION_KEY) || form.region }),
      });
      const json = (await res.json().catch(() => ({}))) as ShowcasePayload & { error?: string };
      if (!res.ok || json.error) {
        setError(json.error ?? `Riot sign-in failed (${res.status})`);
        return;
      }
      setData(json);
      setSelection(buildSelection(json));
      setPage(0);
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
      sessionStorage.setItem(RSO_REGION_KEY, form.region);
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

  function applyShowcase(json: ShowcasePayload) {
    applyData(json);
  }

  async function submitLogin(e: FormEvent) {
    e.preventDefault();
    if (auth.mode === "mfa") {
      await submitMfaOtp();
      return;
    }
    const token = widgetToken(widgetIdRef.current);
    if (captchaNeeded && !captchaSolver) {
      // Host-locked captcha — open remote browser with our form's email/password pre-filled.
      // User only solves captcha/2FA on Riot's real page; no typing into the stream.
      if (creds.email && creds.password) {
        stashRemoteCreds(creds.email, creds.password);
        openRemotePopup();
        return;
      }
      setError(
        "Password mode needs a server-side captcha solver on the hosted site (set CAPMONSTER_API_KEY), " +
          "or use AUTO LOGIN (remote browser) / cookie paste."
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
          region: form.region,
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
      applyShowcase(json as ShowcasePayload);
      setCreds((c) => ({ ...c, password: "", otp: "" }));
    } catch {
      setError("Network error during sign-in.");
    } finally {
      setLoading(null);
    }
  }

  async function submitMfaOtp() {
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
        body: JSON.stringify({ sessionId: auth.sessionId, code: creds.otp, region: form.region }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json?.error) {
        setError(json?.error ?? `Verification failed (${res.status})`);
        return;
      }
      applyShowcase(json as ShowcasePayload);
      setAuth({ mode: "idle", sessionId: "", email: "" });
      setCreds((c) => ({ ...c, password: "", otp: "" }));
    } catch {
      setError("Network error during verification.");
    } finally {
      setLoading(null);
    }
  }

  async function submitAuto() {
    setError(null);
    setLoading("auto");
    // Prefill path: if email+password are on our form, skip local Chrome and go remote with fill.
    const canPrefill = !!creds.email && !!creds.password;
    try {
      if (!canPrefill) {
        const res = await fetch("/api/login/auto", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ region: form.region }),
        });
        const json = (await res.json().catch(() => ({}))) as ShowcasePayload & { error?: string };
        if (res.ok && !json.error) {
          applyShowcase(json as ShowcasePayload);
          return;
        }
      }
      if (canPrefill) stashRemoteCreds(creds.email, creds.password);
      openRemotePopup();
    } catch {
      if (canPrefill) stashRemoteCreds(creds.email, creds.password);
      openRemotePopup();
    } finally {
      setLoading(null);
    }
  }

  function openRemotePopup() {
    setError(null);
    // Ensure popup child can pick up stashed credentials (openRemotePopup may be called alone).
    if (creds.email && creds.password) stashRemoteCreds(creds.email, creds.password);
    const url = `${window.location.origin}/?remote=1&region=${form.region}`;
    const win = window.open(
      url,
      "valorant-remote-login",
      "width=960,height=720,noopener=no,menubar=no,toolbar=no,location=no,status=no"
    );
    if (win) {
      remoteWinRef.current = win;
      setRemoteOpen(false);
      setError("Remote login popup opened — email/password (if entered) are pre-filled; finish captcha/2FA there.");
      return;
    }
    // Popup blocked → inline panel with the same credentials.
    if (creds.email && creds.password) {
      setRemoteCreds({ username: creds.email, password: creds.password });
    }
    setRemoteOpen(true);
  }

  async function submitCookies(e?: { preventDefault(): void }) {
    e?.preventDefault();
    const pasted = normalizeCookiePaste(cookieInput);
    if (!pasted) {
      setError("Paste your ssid cookie value first (see the how-to above).");
      return;
    }
    if (!cookiePasteLooksValid(pasted)) {
      setError(
        "That paste doesn't include an ssid cookie. Copy the ssid value (or the full Cookie header) from auth.riotgames.com — see the how-to above."
      );
      return;
    }
    setError(null);
    setLoading("cookies");
    try {
      const res = await fetch("/api/login/cookies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cookies: pasted, region: form.region }),
      });
      const json = (await res.json().catch(() => ({}))) as ShowcasePayload & { error?: string };
      if (!res.ok || json.error) {
        setError(json.error ?? `Cookie connect failed (${res.status})`);
        return;
      }
      applyShowcase(json);
      setCookieInput("");
    } catch {
      setError("Network error during cookie connect.");
    } finally {
      setLoading(null);
    }
  }

  const section = (kind: ItemKind, title: string, items: AnyItem[]) => (
    <div className="panel" key={kind}>
      <h3>
        {title}
        <span className="count">
          {items.filter((i) => selection[selKey(kind, i.id)]).length}/{items.length}
        </span>
      </h3>
      <div className="bulk">
        <button className="btn ghost" onClick={() => setSection(kind, "all")}>All</button>
        <button className="btn ghost" onClick={() => setSection(kind, "premium")}>Premium</button>
        <button className="btn ghost" onClick={() => setSection(kind, "none")}>None</button>
      </div>
      <div className="chips">
        {items.map((i) => {
          const on = !!selection[selKey(kind, i.id)];
          const icon = "icon" in i ? i.icon : null;
          const skinChromas = kind === "skin" && on ? (i as import("./types").SkinItem).chromas ?? [] : [];
          const activeChromaId = kind === "skin" ? chromaSel[i.id] : undefined;
          return (
            <label
              key={i.id}
              className={"chip" + (on ? " on" : "")}
              style={{ "--rarity": rarityColor(i.price) } as CSSProperties}
            >
              <input type="checkbox" checked={on} onChange={() => toggle(kind, i.id)} />
              {(() => {
                let showIcon = icon;
                if (kind === "skin" && skinChromas.length) {
                  const s = i as import("./types").SkinItem;
                  const ch = s.chromas.find((c) => c.id === (activeChromaId ?? s.defaultChromaId));
                  if (ch?.icon) showIcon = ch.icon;
                }
                return showIcon ? (
                  <img src={img(showIcon)} width={16} height={16} alt="" style={{ display: "block", borderRadius: 2 }} />
                ) : null;
              })()}
              <span className="chip-name" title={i.name}>{i.name}</span>
              {i.price != null && <span className="price">{i.price}</span>}
            </label>
          );
        })}
      </div>
      {kind === "skin" &&
        (() => {
          const withChromas = (items as import("./types").SkinItem[]).filter(
            (s) => selection[selKey("skin", s.id)] && s.chromas.length > 1
          );
          if (!withChromas.length) return null;
          return (
            <div className="chroma-panel">
              <div className="chroma-panel-label">CHROMA — selected skins</div>
              {withChromas.map((s) => {
                const active = chromaSel[s.id] ?? s.defaultChromaId ?? s.chromas[0]?.id;
                return (
                  <div key={s.id} className="chroma-row">
                    <span className="chroma-skin" title={s.name}>{s.name}</span>
                    <span className="chroma-dots">
                      {s.chromas.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          className={"chroma-dot" + (active === c.id ? " on" : "")}
                          title={c.name}
                          onClick={() => pickChroma(s.id, c.id)}
                        >
                          {c.icon ? <img src={img(c.icon)} alt="" /> : c.name.slice(0, 1)}
                        </button>
                      ))}
                    </span>
                  </div>
                );
              })}
            </div>
          );
        })()}
      {items.length === 0 && (
        <p className="note">
          No items in this category.{" "}
          {kind === "skin" &&
            "If you own skins, try NEW ACCOUNT and connect again (or switch region — inventory is shard-specific)."}
        </p>
      )}
    </div>
  );

  if (IS_REMOTE_POPUP) {
    return (
      <div className="app">
        <div className="app-header">
          <h1>REMOTE LOGIN</h1>
          <span className="sub">Riot&apos;s real page — captcha + 2FA work here · cookies stay on the server</span>
        </div>
        <RemoteBrowserPanel
          region={POPUP_REGION}
          credentials={remoteCreds}
          onDone={(json) => {
            if (window.opener && !window.opener.closed) {
              window.opener.postMessage({ type: "valorant-showcase", payload: json }, window.location.origin);
              window.close();
            } else {
              applyShowcase(json);
            }
          }}
        />
        {error && <div className="error" style={{ marginTop: 12 }}>{error}</div>}
      </div>
    );
  }

  if (!data || !pages) {
    return (
      <div className="app">
        <div className="app-header">
          <h1>ACCOUNT SHOWCASE GENERATOR</h1>
          <span className="sub">VALORANT inventory → 1440p share image · no links, no storage</span>
        </div>
        <div className="form-card">
          {error && <div className="error" style={{ marginTop: 0, marginBottom: 14 }}>{error}</div>}

          {/* ---- Cookie paste (primary) ---- */}
          <form onSubmit={submitCookies}>
            <div className="form-row">
              <div className="form-col">
                <label>Region <span className="label-hint">(usually auto-detected)</span></label>
                <select value={form.region} onChange={(e) => setForm({ ...form, region: e.target.value as Region })}>
                  {REGIONS.map((r) => (
                    <option key={r} value={r}>{r.toUpperCase()}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="form-row">
              <div className="form-col">
                <label>ssid cookie</label>
                <input
                  type="text"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="paste ssid value, or ssid=…; asid=…"
                  value={cookieInput}
                  onChange={(e) => setCookieInput(e.target.value)}
                />
                <p className="cookie-hint">
                  Recommended: F12 → Network → open <code>auth.riotgames.com</code> → click any
                  request → Headers → copy the full <strong>cookie</strong> value
                  (<code>ssid=…; asid=…; tdid=…</code>). ssid alone is often not enough.
                </p>
              </div>
            </div>
            <details className="cookie-howto" open>
              <summary>How to get it — 30 seconds, official login, no password here</summary>
              <ol>
                <li>
                  Log in at <strong>playvalorant.com</strong> (or <strong>account.riotgames.com</strong>)
                  in your browser — Riot&apos;s real page, captcha and 2FA included. Tick{" "}
                  <em>Remember me</em>.
                </li>
                <li>
                  <strong>Recommended — Network tab:</strong> press <strong>F12</strong> →{" "}
                  <strong>Network</strong> → open <code>https://auth.riotgames.com/</code> in that tab
                  (the &quot;An error occurred&quot; page is normal — ignore it) → click the{" "}
                  <code>auth.riotgames.com</code> request → <strong>Request Headers</strong> → copy the
                  entire <strong>cookie</strong> value (a long <code>ssid=…; asid=…; tdid=…</code>{" "}
                  string).
                </li>
                <li>
                  <strong>Or Application tab:</strong> <strong>F12</strong> →{" "}
                  <strong>Application</strong> (Chrome) / <strong>Storage</strong> (Firefox) →{" "}
                  <strong>Cookies</strong> → select <strong>auth.riotgames.com</strong> or{" "}
                  <strong>.riotgames.com</strong> — <em>not</em> <code>playvalorant.com</code> → copy
                  the <strong>ssid</strong> value. (Firefox may truncate long values; prefer the
                  Network method.)
                </li>
              </ol>
              <p className="note" style={{ marginTop: 6 }}>
                Your password never leaves Riot. The cookie is used once to mint API tokens, then
                discarded — no login is performed by us at all.
              </p>
            </details>
            <button className="btn btn-block" type="submit" disabled={loading !== null}>
              {loading === "cookies" ? "CONNECTING…" : "CONNECT WITH COOKIE"}
            </button>
          </form>

          {remoteOpen && !IS_REMOTE_POPUP && (
            <>
              <div className="or-divider">remote browser</div>
              <RemoteBrowserPanel
                region={form.region}
                credentials={remoteCreds}
                onDone={(json) => {
                  applyShowcase(json);
                  setRemoteOpen(false);
                  setRemoteCreds(undefined);
                }}
              />
            </>
          )}

          {/* ---- Everything else (collapsed) ---- */}
          <details className="other-ways">
            <summary>Other ways to sign in</summary>

            <div className="form-row" style={{ marginTop: 12 }}>
              <div className="form-col">
                <label>PUUID (optional fallback)</label>
                <input
                  type="text"
                  placeholder="auto-resolved from your access token"
                  value={form.puuid}
                  onChange={(e) => setForm({ ...form, puuid: e.target.value })}
                />
              </div>
            </div>

            <div className="or-divider">email / password (needs CAPMONSTER on hosted)</div>
            <form onSubmit={submitLogin}>
              {auth.mode !== "mfa" && (
                <>
                  <div className="form-row">
                    <div className="form-col">
                      <label>Riot email / username</label>
                      <input
                        type="text"
                        autoComplete="username"
                        placeholder="you@example.com"
                        value={creds.email}
                        onChange={(e) => setCreds({ ...creds, email: e.target.value })}
                      />
                    </div>
                  </div>
                  <div className="form-row">
                    <div className="form-col">
                      <label>Password</label>
                      <input
                        type="password"
                        autoComplete="current-password"
                        value={creds.password}
                        onChange={(e) => setCreds({ ...creds, password: e.target.value })}
                      />
                    </div>
                  </div>
                </>
              )}
              <div
                className={
                  "captcha-box" + (!captchaNeeded || auth.mode === "mfa" ? " captcha-hidden" : "")
                }
                ref={captchaDivRef}
              >
                {captchaStatus === "error" && (
                  <span className="note" style={{ color: "#ffb3ba" }}>
                    Hosted captcha is rejected by Riot (host-lock). Paste the ssid cookie above, or
                    set <code>CAPMONSTER_API_KEY</code> to enable password mode.
                  </span>
                )}
              </div>
              {auth.mode !== "mfa" && (
                <button
                  className="btn btn-block"
                  type="submit"
                  disabled={
                    loading !== null ||
                    (captchaNeeded && !captchaSolver && captchaStatus !== "ready" && captchaStatus !== "error")
                  }
                >
                  {loading === "password" ? "SIGNING IN…" : "SIGN IN & FETCH COLLECTION"}
                </button>
              )}
            </form>
            {auth.mode === "mfa" && (
              <div className="mfa-box">
                <p className="note" style={{ marginTop: 0 }}>
                  We sent a verification code
                  {auth.email ? (<> to <strong>{auth.email}</strong></>) : " to your email"}. Enter it below to
                  continue.
                </p>
                <div className="form-row">
                  <div className="form-col">
                    <label>Verification code</label>
                    <input
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
                  </div>
                </div>
                <div className="mfa-actions">
                  <button className="btn" type="button" onClick={submitMfaOtp} disabled={loading !== null}>
                    {loading === "mfa" ? "VERIFYING…" : "VERIFY & FETCH"}
                  </button>
                  <button
                    className="btn ghost"
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

            <div className="or-divider">or open a Chrome login window</div>
            <button
              className="btn btn-block"
              type="button"
              onClick={submitAuto}
              disabled={loading !== null}
            >
              {loading === "auto" ? "CHECK THE CHROME WINDOW…" : "AUTO LOGIN (OPENS CHROME)"}
            </button>
            <p className="note" style={{ marginTop: 8 }}>
              If your Chrome is already logged into Riot, this usually just works — macOS will ask
              once for Keychain access (click <em>Always Allow</em>). Otherwise a window opens: log
              in there once (tick <em>Remember me</em>), and later clicks reuse the saved session
              with no copying. On the hosted site this falls back to a remote browser.
            </p>

            <div className="or-divider">or paste session tokens manually</div>
            <form onSubmit={fetchAccount}>
              <div className="form-row">
                <div className="form-col">
                  <label>Access token</label>
                  <textarea
                    rows={3}
                    placeholder="eyJ..."
                    value={form.accessToken}
                    onChange={(e) => setForm({ ...form, accessToken: e.target.value })}
                  />
                </div>
              </div>
              <div className="form-row">
                <div className="form-col">
                  <label>Entitlements token (JWT)</label>
                  <textarea
                    rows={3}
                    placeholder="eyJ..."
                    value={form.entitlementsToken}
                    onChange={(e) => setForm({ ...form, entitlementsToken: e.target.value })}
                  />
                </div>
              </div>
              <button className="btn manual" type="submit" disabled={loading !== null}>
                {loading === "tokens" ? "FETCHING…" : "FETCH WITH PASTED TOKENS"}
              </button>
            </form>
            {rso?.configured && (
              <button
                type="button"
                className="btn rso-btn"
                onClick={startRso}
                style={{ marginTop: 10 }}
                disabled={loading !== null}
              >
                {loading === "rso" ? "WORKING…" : "SIGN IN WITH RIOT (OAUTH)"}
              </button>
            )}
          </details>

          <p className="note">
            Cookie and tokens are used in request memory only — never stored or logged — and the
            generated image contains no link. Unofficial tool using Riot&apos;s login and client endpoints;
            no affiliation with Riot Games. Don&apos;t share session tokens with anyone.
          </p>
        </div>
      </div>
    );
  }

  const scale = 0.75;
  const shownCount = pages.totalSelected - pages.truncated;

  return (
    <div className="app">
      <div className="app-header">
        <h1>ACCOUNT SHOWCASE GENERATOR</h1>
        <span className="sub">
          {data.gameName}
          {data.tagLine ? `#${data.tagLine}` : ""} · {data.region.toUpperCase()}
          {data.accountLevel != null ? ` · LV. ${data.accountLevel}` : ""}
        </span>
        <button
          className="btn ghost"
          style={{ marginLeft: "auto" }}
          onClick={() => {
            setData(null);
            setSelection({});
            setChromaSel({});
            setError(null);
            setLoading(null);
            setForm({ region: form.region, accessToken: "", entitlementsToken: "", puuid: "" });
            setCreds({ email: "", password: "", otp: "" });
            setAuth({ mode: "idle", sessionId: "", email: "" });
            setCookieInput("");
            setCaptchaNeeded(false);
            setCaptchaStatus("loading");
            setCaptchaSolver(false);
            setRemoteOpen(false);
            setRemoteCreds(undefined);
            if (captchaDivRef.current) captchaDivRef.current.innerHTML = "";
            widgetIdRef.current = null;
          }}
        >
          NEW ACCOUNT
        </button>
      </div>
      {error && <div className="error">{error}</div>}
      <div className="workspace">
        <div className="controls">
          <div className="panel">
            <h3>SELECTION</h3>
            <div className="bulk">
              <button className="btn ghost" onClick={() => allSections("premium")}>Select all premium</button>
              <button className="btn ghost" onClick={() => allSections("all")}>Select all</button>
              <button className="btn ghost" onClick={() => allSections("none")}>Clear all</button>
            </div>
            {!data.pricesAvailable && (
              <p className="note">Price feed unavailable — defaults fall back to the level heuristic.</p>
            )}
          </div>
          {section("skin", "SKINS", data.skins)}
          {section("card", "CARDS", data.cards)}
          {section("title", "TITLES", data.titles)}
          {section("buddy", "BUDDIES", data.buddies)}
          <div className="panel">
            <h3>FOOTER FIELDS</h3>
            <div className="footer-opts">
              <label className="opt">
                <input type="checkbox" checked={fm.on} onChange={(e) => setFm({ ...fm, on: e.target.checked })} />
                FM
              </label>
              {fm.on && (
                <input type="text" placeholder="FM note" value={fm.text} onChange={(e) => setFm({ ...fm, text: e.target.value })} />
              )}
              <label className="opt">
                <input type="checkbox" checked={proof.on} onChange={(e) => setProof({ ...proof, on: e.target.checked })} />
                PROOF
              </label>
              {proof.on && (
                <input type="text" placeholder="proof note" value={proof.text} onChange={(e) => setProof({ ...proof, text: e.target.value })} />
              )}
            </div>
          </div>
        </div>

        <div className="preview-area">
          <div className="preview-bar">
            <button className="btn" onClick={exportImages} disabled={exporting}>
              {exporting
                ? "EXPORTING…"
                : pages.gridPages.length > 1
                  ? `DOWNLOAD ${pages.gridPages.length} IMAGES (1440P)`
                  : "DOWNLOAD IMAGE (1440P)"}
            </button>
            {pages.gridPages.length > 1 && (
              <div className="pager">
                <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}>◀</button>
                <span>{page + 1} / {pages.gridPages.length}</span>
                <button
                  onClick={() => setPage((p) => Math.min(pages.gridPages.length - 1, p + 1))}
                  disabled={page >= pages.gridPages.length - 1}
                >
                  ▶
                </button>
              </div>
            )}
            <span className="export-note">
              {shownCount}/{pages.totalSelected} skins · {pages.density.name} grid · click a tile to toggle
            </span>
          </div>
          <div className="preview-frame" style={{ width: CANVAS_W * scale, height: CANVAS_H * scale }}>
            <div className="preview-scale" style={{ transform: `scale(${scale})` }}>
              <Showcase
                payload={data}
                pages={pages}
                page={page}
                selection={selection}
                chromaSel={chromaSel}
                footer={footerOpts}
                onToggleSkin={(id) => toggle("skin", id)}
                onPickChroma={pickChroma}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="hidden-export" aria-hidden="true">
        {pages.gridPages.map((_, i) => (
          <div key={i} data-export-page>
            <Showcase payload={data} pages={pages} page={i} selection={selection} footer={footerOpts} />
          </div>
        ))}
      </div>
    </div>
  );
}



