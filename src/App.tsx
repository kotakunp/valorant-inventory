import { useMemo, useState, useEffect, useRef, type FormEvent, type CSSProperties } from "react";
import { toPng } from "html-to-image";
import type { ChromaSelection, ItemKind, Region, Selection, ShowcasePayload, SkinItem } from "./types";
import { selKey } from "./types";
import { buildSelection, collectionValue, groupByGun, isPremiumSkin, paginate, rarityColor, vpToUsd } from "./logic";
import type { AnyItem } from "./logic";
import { makeState, parseCallback, RSO_STATE_KEY, RSO_REGION_KEY } from "./rso";
import { SITEKEY, loadHcaptcha, widgetToken, resetCaptcha, renderCaptcha, fetchCaptchaChallenge } from "./captcha";
import { Showcase, CANVAS_W, CANVAS_H } from "./Showcase";
import { RemoteBrowserPanel } from "./RemoteBrowser";
import { StorePanel } from "./StorePanel";
import { ACCESS_URL_LOGIN_LINK } from "./types";

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

type LoadKind = "cookies" | "password" | "mfa" | "auto" | "url" | "rso";

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

export default function App() {
  const [form, setForm] = useState({ region: "na" as Region, accessUrl: "" });
  const [data, setData] = useState<ShowcasePayload | null>(null);
  const [selection, setSelection] = useState<Selection>({});
  const [chromaSel, setChromaSel] = useState<ChromaSelection>({});
  const [bringToFront, setBringToFront] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<LoadKind | null>(null);
  const [page, setPage] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [exportPhase, setExportPhase] = useState<string | null>(null);
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
  const [cookieFailed, setCookieFailed] = useState(false);
  const [skinQuery, setSkinQuery] = useState("");
  const [skinFilter, setSkinFilter] = useState<"all" | "selected" | "equipped">("all");
  const [collapsedGuns, setCollapsedGuns] = useState<Record<string, boolean>>({});
  const [zoom, setZoom] = useState<"fit" | "100">("fit");
  const [fitScale, setFitScale] = useState(0.75);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [remoteOpen, setRemoteOpen] = useState(false);
  const [remoteCreds, setRemoteCreds] = useState<{ username: string; password: string } | undefined>(() =>
    IS_REMOTE_POPUP ? takeRemoteCreds() : undefined
  );
  const remoteWinRef = useRef<Window | null>(null);
  const captchaDivRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const previewAreaRef = useRef<HTMLDivElement>(null);

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

  // Fit preview to available width (export canvas stays fixed 1280×720).
  useEffect(() => {
    const el = previewAreaRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const fit = () => {
      const w = el.clientWidth;
      if (w > 0) setFitScale(Math.min(1, Math.max(0.1, (w - 2) / CANVAS_W)));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [data]);

  // Fullscreen preview (editor-only zoom control — never affects export geometry).
  useEffect(() => {
    const onFs = () => setIsFullscreen(document.fullscreenElement === previewAreaRef.current);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void previewAreaRef.current?.requestFullscreen?.().catch(() => undefined);
  };

  const previewScale = zoom === "fit" ? fitScale : 1;

  const pages = useMemo(() => {
    if (!data) return null;
    return paginate(data.skins, selection);
  }, [data, selection]);

  /** Skin grid groups: search / ALL·SELECTED·EQUIPPED filter → official gun groups (§3). */
  const skinGroups = useMemo(() => {
    if (!data) return [];
    const q = skinQuery.trim().toLowerCase();
    let items = data.skins;
    if (q) {
      items = items.filter(
        (s) => s.name.toLowerCase().includes(q) || s.weaponName.toLowerCase().includes(q)
      );
    }
    if (skinFilter === "selected") {
      items = items.filter((s) => selection[selKey("skin", s.id)]);
    } else if (skinFilter === "equipped") {
      items = items.filter((s) => s.equipped);
    }
    return groupByGun(items);
  }, [data, skinQuery, skinFilter, selection]);

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

  async function fetchAccessUrl(e: FormEvent) {
    e.preventDefault();
    const url = form.accessUrl.trim();
    if (!url) {
      setError("Paste the full access URL from the Riot sign-in redirect.");
      return;
    }
    if (!url.includes("#")) {
      setError("That URL has no #fragment — copy the ENTIRE address bar URL from the redirect page (Riot puts the token after the #).");
      return;
    }
    if (!url.includes("access_token=")) {
      setError("No access_token in that URL — open the sign-in link in the how-to, log in, then paste the redirect URL.");
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
      applyShowcase(json);
    } catch {
      setError("Network error — is the server running on port 3001?");
    } finally {
      setLoading(null);
    }
  }

  const toggle = (kind: ItemKind, id: string) =>
    setSelection((s) => ({ ...s, [selKey(kind, id)]: !s[selKey(kind, id)] }));

  const removeSkin = (id: string) =>
    setSelection((s) => ({ ...s, [selKey("skin", id)]: false }));

  const bringSkinToFront = (gunId: string, skinId: string) =>
    setBringToFront((m) => ({ ...m, [gunId]: skinId }));

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
                ? isPremiumSkin(it as SkinItem)
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
      setExportPhase("PREPARING ASSETS…");
      await document.fonts.ready;
      const nodes = Array.from(document.querySelectorAll<HTMLElement>("[data-export-page]"));
      const imgs = Array.from(document.querySelectorAll<HTMLImageElement>("[data-export-page] img"));
      const failed: string[] = [];
      await Promise.all(
        imgs.map((i) =>
          i.complete && i.naturalWidth > 0
            ? Promise.resolve()
            : new Promise<void>((r) => {
                i.addEventListener("load", () => r(), { once: true });
                i.addEventListener("error", () => {
                  failed.push(i.src);
                  r();
                }, { once: true });
              })
        )
      );
      if (failed.length) {
        throw new Error(`${failed.length} artwork image(s) failed to load — check your connection and try again.`);
      }
      const slug = `${data.gameName}_${data.tagLine}`.replace(/[^\w-]+/g, "") || "account";
      for (let i = 0; i < nodes.length; i++) {
        setExportPhase(
          nodes.length > 1 ? `RENDERING ${i + 1} / ${nodes.length}…` : "RENDERING 2560 × 1440…"
        );
        const url = await toPng(nodes[i], { pixelRatio: 2, backgroundColor: "#0f1923", width: CANVAS_W, height: CANVAS_H });
        const a = document.createElement("a");
        a.href = url;
        a.download = `showcase-${slug}-p${i + 1}.png`;
        a.click();
        await new Promise((r) => setTimeout(r, 400));
      }
      setExportPhase("DOWNLOADED ✓");
      await new Promise((r) => setTimeout(r, 1600));
    } catch (e) {
      setError(`Export failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setExportPhase(null);
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
      applyShowcase(json);
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
    setCookieFailed(false);
    setLoading("cookies");
    try {
      const res = await fetch("/api/login/cookies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cookies: pasted, region: form.region }),
      });
      const json = (await res.json().catch(() => ({}))) as ShowcasePayload & { error?: string };
      if (!res.ok || json.error) {
        setCookieFailed(true);
        setError(json.error ?? `Cookie connect failed (${res.status})`);
        return;
      }
      applyShowcase(json);
      setCookieInput("");
    } catch {
      setCookieFailed(true);
      setError("Network error during cookie connect.");
    } finally {
      setLoading(null);
    }
  }

  const section = (kind: ItemKind, title: string, items: AnyItem[]) => {
    const selectedCount = items.filter((i) => selection[selKey(kind, i.id)]).length;
    const query = kind === "skin" ? skinQuery.trim().toLowerCase() : "";

    return (
      <div className="panel" key={kind}>
        <h3>
          {title}
          <span className="count">
            {selectedCount}/{items.length}
          </span>
        </h3>
        {kind !== "skin" && (
          <div className="bulk">
            <button className="btn ghost" onClick={() => setSection(kind, "all")}>All</button>
            <button className="btn ghost" onClick={() => setSection(kind, "premium")}>Premium</button>
            <button className="btn ghost" onClick={() => setSection(kind, "none")}>None</button>
          </div>
        )}

        {kind === "skin" && (
          <div className="skin-tools">
            <div className="skin-search">
              <input
                type="text"
                placeholder="Search skins…"
                value={skinQuery}
                onChange={(e) => setSkinQuery(e.target.value)}
                aria-label="Search skins"
              />
            </div>
            <div className="seg" role="group" aria-label="Filter skins">
              {(["all", "selected", "equipped"] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  className={skinFilter === f ? "on" : ""}
                  aria-pressed={skinFilter === f}
                  onClick={() => setSkinFilter(f)}
                >
                  {f.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
        )}

        {kind === "skin" ? (
          <div className="skin-cats">
            {skinGroups.length === 0 && (
              <div className="skin-empty">
                {query
                  ? "No skins match your filter."
                  : skinFilter !== "all"
                    ? "No skins in this filter."
                    : "No skins in this category."}
                {!query &&
                  skinFilter === "all" &&
                  " Try SWITCH ACCOUNT and connect again."}
              </div>
            )}
            {skinGroups.map((g) => {
              const sel = g.items.filter((i) => selection[selKey("skin", i.id)]).length;
              const open = !!query || !collapsedGuns[g.id];
              return (
                <div className="skin-cat" key={g.id}>
                  <button
                    type="button"
                    className="skin-cat-head"
                    aria-expanded={open}
                    onClick={() => setCollapsedGuns((c) => ({ ...c, [g.id]: !c[g.id] }))}
                  >
                    <span className="skin-cat-caret" aria-hidden="true" data-open={open} />
                    <span className="skin-cat-name">{g.label}</span>
                    <span className="skin-cat-count">
                      {sel}/{g.items.length}
                    </span>
                  </button>
                  {open && (
                    <div className="skin-grid">
                      {g.items.map((i) => {
                        const on = !!selection[selKey(kind, i.id)];
                        const activeChromaId = chromaSel[i.id];
                        const ch =
                          i.chromas.find((c) => c.id === (activeChromaId ?? i.defaultChromaId)) ??
                          i.chromas[0];
                        const icon = ch?.icon ?? i.icon;
                        return (
                          <button
                            key={i.id}
                            type="button"
                            className={`skin-cell${on ? " on" : ""}${i.equipped ? " eq" : ""}`}
                            style={{ "--rarity": rarityColor(i.price, i.levelCount, i.contentTierRank ?? null) } as CSSProperties}
                            onClick={() => toggle(kind, i.id)}
                            title={`${i.name} · ${i.weaponName}${i.price != null ? ` · ${fmt(i.price)} VP` : ""}${i.equipped ? " · equipped" : ""}`}
                            aria-pressed={on}
                          >
                            {i.price != null && <span className="vp">{i.price}</span>}
                            <span className="skin-cell-art">
                              {icon ? <img src={img(icon)} alt="" /> : null}
                            </span>
                            <span className="skin-cell-name">{i.name}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="chips">
            {items.map((i) => {
              const on = !!selection[selKey(kind, i.id)];
              const icon =
                kind === "card" && "avatar" in i && i.avatar
                  ? i.avatar
                  : "icon" in i
                    ? i.icon
                    : null;
              return (
                <label
                  key={i.id}
                  className={"chip" + (on ? " on" : "")}
                  style={{
                    "--rarity": rarityColor(
                      i.price,
                      "levelCount" in i ? i.levelCount : 0,
                      "contentTierRank" in i ? (i as SkinItem).contentTierRank ?? null : null
                    ),
                  } as CSSProperties}
                >
                  <input type="checkbox" checked={on} onChange={() => toggle(kind, i.id)} />
                  {icon ? (
                    <img src={img(icon)} width={16} height={16} alt="" />
                  ) : null}
                  <span className="chip-name" title={i.name}>{i.name}</span>
                  {i.price != null && <span className="price">{i.price}</span>}
                </label>
              );
            })}
            {items.length === 0 && (
              <p className="note" style={{ margin: 0 }}>
                No items in this category.
              </p>
            )}
          </div>
        )}

        {kind === "skin" &&
          (() => {
            const withChromas = (items as import("./types").SkinItem[]).filter(
              (s) => selection[selKey("skin", s.id)] && s.chromas.length > 1
            );
            if (!withChromas.length) return null;
            return (
              <div className="chroma-panel">
                <div className="chroma-panel-label">Chroma — selected skins</div>
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
        {items.length === 0 && kind !== "skin" && (
          <p className="note">
            No items in this category.
          </p>
        )}
      </div>
    );
  };

  if (IS_REMOTE_POPUP) {
    return (
      <div className="app">
        <div className="app-header">
          <span className="brand-mark" aria-hidden="true" />
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
      <div className="gate">
        <div className="gate-card">
          <div className="gate-brand">
            <div className="gate-logo-row">
              <span className="brand-mark brand-mark--lg" aria-hidden="true" />
              <span className="gate-logo">COLLECTION</span>
            </div>
            <span className="gate-tagline">
              VALORANT inventory → 1440p share image · no links, no storage
            </span>
          </div>

          {error && (
            <div className="error" style={{ marginTop: 0, marginBottom: 14 }}>
              <span>{cookieFailed ? humanizeCookieError(error) : error}</span>
              {cookieFailed && (
                <button type="button" className="btn ghost gate-retry" onClick={() => void submitCookies()}>
                  Try again
                </button>
              )}
            </div>
          )}

          {/* ---- Access URL (primary) — direct link + always-visible guide;
                 region/PUUID auto-detected server-side, no server picker ---- */}
          <form onSubmit={fetchAccessUrl}>
            <div className="cookie-howto access-steps">
              <ol>
                <li>
                  Open the{" "}
                  <a
                    className="access-link"
                    href={ACCESS_URL_LOGIN_LINK}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    Riot sign-in link →
                  </a>{" "}
                  — Riot&apos;s real page, captcha and 2FA included.
                </li>
                <li>
                  Sign in, then you land on <strong>playvalorant.com/opt_in</strong> — a blank or
                  &quot;404&quot; page is normal, ignore it.
                </li>
                <li>
                  Copy the <strong>entire address bar URL</strong>, including everything after{" "}
                  <code>#</code>.
                </li>
                <li>Paste it below and hit <strong>Load collection</strong>. Valid ~1 hour.</li>
              </ol>
              <p className="note" style={{ marginTop: 6 }}>
                Your server is auto-detected — no region setting needed. The token is used once to
                mint API tokens in request memory — never stored or logged. You never type your
                password here.
              </p>
            </div>
            <div className="form-row">
              <div className="form-col">
                <label>Access URL</label>
                <textarea
                  rows={3}
                  spellCheck={false}
                  placeholder="https://playvalorant.com/opt_in#access_token=…"
                  value={form.accessUrl}
                  onChange={(e) => setForm({ ...form, accessUrl: e.target.value })}
                />
              </div>
            </div>
            <button className="btn btn-block" type="submit" disabled={loading !== null}>
              {loading === "url" ? "FETCHING…" : "LOAD COLLECTION"}
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
            <summary>Other sign-in methods ▾</summary>

            {/* ---- Cookie paste (fallback) — region auto-detected server-side ---- */}
            <form onSubmit={submitCookies}>
              <div className="form-row">
                <div className="form-col">
                  <label>ssid cookie</label>
                  <input
                    type="text"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="Paste ssid value, or ssid=…; asid=…; tdid=…"
                    value={cookieInput}
                    onChange={(e) => {
                      setCookieInput(e.target.value);
                      if (cookieFailed) {
                        setCookieFailed(false);
                        setError(null);
                      }
                    }}
                  />
                  <p className="cookie-hint">
                    Full Cookie header recommended — ssid alone is often not enough.
                  </p>
                </div>
              </div>
              <details className="cookie-howto">
                <summary>Where do I find this?</summary>
                <ol>
                  <li>
                    Log in at <strong>playvalorant.com</strong> (or <strong>account.riotgames.com</strong>)
                    in your browser — Riot&apos;s real page, captcha and 2FA included. Tick{" "}
                    <em>Remember me</em>.
                  </li>
                  <li>
                    Press <strong>F12</strong> → open the <strong>Network</strong> tab → load{" "}
                    <a href="https://auth.riotgames.com/" target="_blank" rel="noreferrer noopener">
                      <code>https://auth.riotgames.com/</code>
                    </a>{" "}
                    in it (the &quot;An error occurred&quot; page is normal — ignore it).
                  </li>
                  <li>
                    Click the <code>auth.riotgames.com</code> request → <strong>Request Headers</strong>{" "}
                    → copy the entire <strong>cookie</strong> value (a long{" "}
                    <code>ssid=…; asid=…; tdid=…</code> string).
                  </li>
                  <li>
                    Paste it above and hit <strong>Load collection</strong>. Full Cookie header
                    recommended — ssid alone is often not enough. (Application tab → Cookies →{" "}
                    <strong>.riotgames.com</strong> works too; Firefox may truncate long values.)
                  </li>
                </ol>
                <p className="note" style={{ marginTop: 6 }}>
                  Your password never leaves Riot. The cookie is used once to mint API tokens, then
                  discarded — no login is performed by us at all.
                </p>
              </details>
              <button className="btn btn-block" type="submit" disabled={loading !== null}>
                {loading === "cookies" ? "LOADING…" : "LOAD WITH COOKIE"}
              </button>
            </form>

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

          <p className="gate-foot">
            Cookie and tokens are used in request memory only — never stored or logged — and the
            generated image contains no link. Unofficial tool using Riot&apos;s login and client endpoints;
            no affiliation with Riot Games. Don&apos;t share session tokens with anyone.
          </p>
        </div>
      </div>
    );
  }

  const shownCount = pages.totalSelected - pages.truncated;
  // Live collection total (list prices) for the selection panel.
  const selVp = data ? collectionValue(data, selection) : 0;

  const resetAccount = () => {
    setData(null);
    setSelection({});
    setChromaSel({});
    setBringToFront({});
    setError(null);
    setLoading(null);
    setPage(0);
    setSkinQuery("");
    setSkinFilter("all");
    setCollapsedGuns({});
    setZoom("fit");
    setExportPhase(null);
    setCookieFailed(false);
    setForm({ region: form.region, accessUrl: "" });
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
  };

  const switchAccount = () => {
    if (
      !window.confirm("Switch account? Your current selection and showcase will be cleared.")
    ) {
      return;
    }
    resetAccount();
  };

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand-mark" aria-hidden="true" />
        <span className="topbar-div" aria-hidden="true" />
        <span className="topbar-brand">COLLECTION</span>
        <div className="topbar-id">
          <div className="topbar-name">
            {data.gameName}
            {data.tagLine && <span className="topbar-tag">#{data.tagLine}</span>}
            <span className="topbar-sub">
              {data.accountLevel != null && <>· LV. {data.accountLevel}</>} · {data.region.toUpperCase()}
            </span>
          </div>
          <div className="topbar-meta">
            <span>
              {shownCount}/{data.skins.length} selected
            </span>
            {pages.gridPages.length > 1 && (
              <span>
                · {pages.density.name} · page {page + 1}/{pages.gridPages.length}
              </span>
            )}
          </div>
        </div>
        <div className="topbar-actions">
          <button className="btn ghost" onClick={switchAccount}>Switch account</button>
        </div>
      </header>
      {error && <div className="error">{error}</div>}
      <div className="workspace">
        <div className="controls">
          <div className="panel">
            <h3>
              Selection
              <span className="count">{pages.totalSelected} selected</span>
            </h3>
            <div className="bulk">
              <button className="btn ghost" onClick={() => allSections("premium")}>Premium+</button>
              <button className="btn ghost" onClick={() => allSections("all")}>Select all</button>
              <button className="btn ghost" onClick={() => allSections("none")}>Clear</button>
            </div>
            {selVp > 0 && (
              <p className="sel-value">
                <strong>{fmt(selVp)} VP</strong> spent · ~${fmt(vpToUsd(selVp))}
              </p>
            )}
            <p className="note" style={{ marginTop: 0 }}>
              Premium+ and equipped cosmetics were selected automatically.
            </p>
            {!data.pricesAvailable && (
              <p className="note" style={{ marginTop: 6 }}>
                Price feed unavailable — defaults fall back to the level heuristic.
              </p>
            )}
          </div>
          {section("skin", "Skins", data.skins)}
          {section("card", "Cards", data.cards)}
          {section("title", "Titles", data.titles)}
          {section("buddy", "Buddies", data.buddies)}
        </div>

        <div className="preview-area" ref={previewAreaRef}>
          <div className="preview-bar">
            <button className="btn" onClick={exportImages} disabled={exporting}>
              {exportPhase ??
                (pages.gridPages.length > 1
                  ? `DOWNLOAD ${pages.gridPages.length} IMAGES (1440P)`
                  : "DOWNLOAD IMAGE (1440P)")}
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
              Hover a stack to browse its skins
            </span>
            <div className="zoom-group" role="group" aria-label="Preview zoom">
              <button
                type="button"
                className={zoom === "fit" ? "on" : ""}
                aria-pressed={zoom === "fit"}
                onClick={() => setZoom("fit")}
              >
                Fit
              </button>
              <button
                type="button"
                className={zoom === "100" ? "on" : ""}
                aria-pressed={zoom === "100"}
                onClick={() => setZoom("100")}
              >
                100%
              </button>
              <button type="button" className="zoom-fs" onClick={toggleFullscreen}>
                {isFullscreen ? "Exit fullscreen" : "Fullscreen"}
              </button>
            </div>
          </div>
          <div className="preview-scroll">
            <div
              className="preview-frame"
              style={{ width: Math.round(CANVAS_W * previewScale), height: Math.round(CANVAS_H * previewScale) }}
            >
              <div className="preview-scale" style={{ transform: `scale(${previewScale})` }}>
                <Showcase
                  payload={data}
                  pages={pages}
                  page={page}
                  selection={selection}
                  chromaSel={chromaSel}
                  bringToFront={bringToFront}
                  onRemoveSkin={removeSkin}
                  onBringToFront={bringSkinToFront}
                  onPickChroma={pickChroma}
                />
              </div>
            </div>
            {data.store && (
              <StorePanel store={data.store} generatedAt={data.generatedAt} width={Math.round(CANVAS_W * previewScale)} />
            )}
          </div>
        </div>
      </div>

      <div className="hidden-export" aria-hidden="true">
        {pages.gridPages.map((_, i) => (
          <div key={i} data-export-page>
            <Showcase
              payload={data}
              pages={pages}
              page={i}
              selection={selection}
              chromaSel={chromaSel}
              bringToFront={bringToFront}
            />
          </div>
        ))}
      </div>
    </div>
  );
}



