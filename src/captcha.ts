// hCaptcha widget — sitekey + optional Enterprise rqdata from Riot's authenticator.
export const SITEKEY = "019f1553-3845-481c-a6f5-5a60ccf6d830";

declare global {
  interface Window {
    hcaptcha?: {
      render: (el: HTMLElement | string, opts: Record<string, unknown>) => string;
      getResponse: (id?: string) => string;
      reset: (id?: string) => void;
    };
  }
}

export function loadHcaptcha(): Promise<void> {
  if (window.hcaptcha) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[src*="js.hcaptcha.com"]');
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("hcaptcha failed to load")), { once: true });
      return;
    }
    const s = document.createElement("script");
    s.src = "https://js.hcaptcha.com/1/api.js?render=explicit&hl=en";
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("hcaptcha failed to load"));
    document.head.appendChild(s);
  });
}

export function renderCaptcha(
  el: HTMLElement,
  opts: { sitekey: string; rqdata?: string | null }
): string {
  const payload: Record<string, unknown> = { sitekey: opts.sitekey, theme: "dark" };
  // Enterprise mode: rqdata from the authenticator challenge is required for Riot to accept the token.
  if (opts.rqdata) payload.data = opts.rqdata;
  return window.hcaptcha!.render(el, payload);
}

export function widgetToken(widgetId: string | null): string {
  if (!widgetId || !window.hcaptcha) return "";
  try {
    return window.hcaptcha.getResponse(widgetId) ?? "";
  } catch {
    return "";
  }
}

export function resetCaptcha(widgetId: string | null): void {
  if (!widgetId || !window.hcaptcha) return;
  try {
    window.hcaptcha.reset(widgetId);
  } catch {
    /* widget already gone */
  }
}

export interface CaptchaChallenge {
  sitekey: string;
  rqdata: string | null;
  /** Server-side session id — must be sent back with the solved token. */
  captchaSessionId?: string;
}

/** Fetch Riot's Enterprise sitekey + rqdata (best-effort; falls back to static sitekey). */
export async function fetchCaptchaChallenge(): Promise<CaptchaChallenge> {
  try {
    const res = await fetch("/api/login/captcha-challenge");
    if (res.ok) {
      const j = await res.json();
      if (typeof j?.sitekey === "string" && j.sitekey) {
        return {
          sitekey: j.sitekey,
          rqdata: typeof j.rqdata === "string" ? j.rqdata : null,
          captchaSessionId: typeof j.captchaSessionId === "string" ? j.captchaSessionId : undefined,
        };
      }
    }
  } catch {
    /* offline / server down */
  }
  return { sitekey: SITEKEY, rqdata: null };
}
