import { AuthFlowError, parseTokenLocation } from "./riotAuth";

// The sign-in link lives in src/types.ts (shared: UI shows it, tests assert it).

export { ACCESS_URL_LOGIN_LINK } from "../src/types";

/** JWT payload `exp` (ms) when parseable, else null. */
function jwtExpMs(jwt: string): number | null {
  try {
    const payload = jwt.split(".")[1];
    if (!payload) return null;
    const json = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return typeof json.exp === "number" ? json.exp * 1000 : null;
  } catch {
    return null;
  }
}

/**
 * Extract `access_token` (+ optional `id_token`) from a pasted Riot redirect URL.
 * Fragment (`#access_token=…`, canonical) first, query string as a fallback.
 * Throws AuthFlowError with copy-paste-friendly messages for every miss.
 */
export function extractAccessUrl(raw: unknown): { accessToken: string; idToken: string } {
  if (typeof raw !== "string" || !raw.trim()) {
    throw new AuthFlowError("Paste the full access URL from the Riot sign-in redirect.", 400);
  }
  const url = raw.trim();

  const fromFragment = parseTokenLocation(url);
  if (fromFragment?.accessToken) {
    assertFresh(fromFragment.accessToken);
    return fromFragment;
  }

  // Fallback: some browsers/tools surface the tokens on the query string.
  let query: URLSearchParams | null = null;
  try {
    query = new URL(url).searchParams;
  } catch {
    query = null;
  }
  const qToken = query?.get("access_token");
  if (qToken) {
    assertFresh(qToken);
    return { accessToken: qToken, idToken: query?.get("id_token") ?? "" };
  }

  if (!url.includes("#")) {
    throw new AuthFlowError(
      "That URL has no #fragment — copy the ENTIRE address bar URL from the redirect page (Riot puts the token after the #).",
      400
    );
  }
  throw new AuthFlowError(
    "No access_token found in that URL — use the sign-in link in the how-to, then paste the full playvalorant.com redirect URL.",
    400
  );
}

function assertFresh(accessToken: string): void {
  const exp = jwtExpMs(accessToken);
  if (exp != null && exp < Date.now()) {
    throw new AuthFlowError(
      "That access token has expired (1 hour) — open the sign-in link again and paste a fresh URL.",
      401
    );
  }
}
