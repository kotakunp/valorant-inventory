import { describe, expect, it } from "vitest";
import { buildAuthorizeUrl, decodeJwtSub, tokenRequestBody } from "./rso";

const cfg = { clientId: "cid-123", redirectUri: "https://app.example/rso/callback", clientSecret: null };

describe("buildAuthorizeUrl", () => {
  it("includes all required OAuth parameters", () => {
    const url = new URL(buildAuthorizeUrl(cfg, "st4te"));
    expect(url.origin + url.pathname).toBe("https://auth.riotgames.com/authorize");
    expect(url.searchParams.get("client_id")).toBe("cid-123");
    expect(url.searchParams.get("redirect_uri")).toBe(cfg.redirectUri);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toBe("openid offline_access");
    expect(url.searchParams.get("state")).toBe("st4te");
  });
});

describe("tokenRequestBody", () => {
  it("encodes the authorization_code grant", () => {
    const p = new URLSearchParams(tokenRequestBody(cfg, "thecode"));
    expect(p.get("grant_type")).toBe("authorization_code");
    expect(p.get("code")).toBe("thecode");
    expect(p.get("client_id")).toBe("cid-123");
    expect(p.get("client_secret")).toBeNull();
  });
  it("adds client_secret only when configured", () => {
    const p = new URLSearchParams(tokenRequestBody({ ...cfg, clientSecret: "s3cret" }, "c"));
    expect(p.get("client_secret")).toBe("s3cret");
  });
});

describe("decodeJwtSub", () => {
  it("extracts sub from a JWT payload", () => {
    const payload = Buffer.from(JSON.stringify({ sub: "puuid-1" })).toString("base64url");
    expect(decodeJwtSub(`e30.${payload}.sig`)).toBe("puuid-1");
  });
  it("returns null for garbage", () => {
    expect(decodeJwtSub("not-a-jwt")).toBeNull();
    expect(decodeJwtSub("a.%%%.b")).toBeNull();
  });
});
