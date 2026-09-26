import { describe, it, expect } from "vitest";
import { ACCESS_URL_LOGIN_LINK, extractAccessUrl } from "./accessUrl";
import { AuthFlowError } from "./riotAuth";

const b64url = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (payload: object) => `${b64url({ alg: "none" })}.${b64url(payload)}.sig`;

const FRESH = jwt({ sub: "puuid-1", exp: Math.floor(Date.now() / 1000) + 3600 });
const EXPIRED = jwt({ sub: "puuid-1", exp: Math.floor(Date.now() / 1000) - 60 });

const fragUrl = (token: string, idToken = "") =>
  `https://playvalorant.com/opt_in#access_token=${token}&scope=openid&iss=https%3A%2F%2Fauth.riotgames.com` +
  (idToken ? `&id_token=${idToken}` : "") +
  "&token_type=Bearer&expires_in=3600";

describe("extractAccessUrl", () => {
  it("extracts access_token + id_token from the fragment", () => {
    const id = jwt({ sub: "puuid-1" });
    const out = extractAccessUrl(fragUrl(FRESH, id));
    expect(out.accessToken).toBe(FRESH);
    expect(out.idToken).toBe(id);
  });

  it("falls back to query-string tokens", () => {
    const out = extractAccessUrl(`https://playvalorant.com/opt_in?access_token=${FRESH}&id_token=x`);
    expect(out.accessToken).toBe(FRESH);
    expect(out.idToken).toBe("x");
  });

  it("rejects pastes without a fragment (points at the #)", () => {
    expect(() => extractAccessUrl("https://playvalorant.com/opt_in")).toThrowError(/#fragment/);
  });

  it("rejects fragments without access_token", () => {
    expect(() => extractAccessUrl("https://playvalorant.com/opt_in#foo=bar")).toThrowError(/access_token/);
  });

  it("rejects empty / non-string input", () => {
    expect(() => extractAccessUrl("")).toThrowError(/full access URL/);
    expect(() => extractAccessUrl(undefined)).toThrowError(/full access URL/);
  });

  it("rejects expired tokens", () => {
    try {
      extractAccessUrl(fragUrl(EXPIRED));
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(AuthFlowError);
      expect((e as AuthFlowError).status).toBe(401);
      expect((e as AuthFlowError).message).toMatch(/expired/);
    }
  });

  it("login link targets the playvalorant implicit flow", () => {
    const link = new URL(ACCESS_URL_LOGIN_LINK);
    expect(link.origin + link.pathname).toBe("https://auth.riotgames.com/authorize");
    expect(link.searchParams.get("client_id")).toBe("play-valorant-web-prod");
    expect(link.searchParams.get("redirect_uri")).toBe("https://playvalorant.com/opt_in");
    expect(link.searchParams.get("response_type")).toBe("token id_token");
  });
});
