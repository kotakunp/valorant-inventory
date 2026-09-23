import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AuthFlowError,
  classifyAuthResponse,
  CookieJar,
  createSession,
  destroySession,
  extractTokens,
  getSession,
  isLoginRedirect,
  loginWithCookies,
  normalizeRegion,
  parseCookieInput,
  parseTokenLocation,
  rateLimit,
} from "./riotAuth";

describe("CookieJar", () => {
  it("collects set-cookie headers and emits a Cookie header", () => {
    const jar = new CookieJar();
    const h = new Headers();
    h.append("set-cookie", "tdid=t1; Path=/; Secure");
    h.append("set-cookie", "ssid=s1; Path=/; HttpOnly");
    jar.absorb(h);
    expect(jar.header()).toBe("tdid=t1; ssid=s1");
    expect(jar.has("ssid")).toBe(true);
  });
  it("overwrites cookies with the same name", () => {
    const jar = new CookieJar();
    const h = new Headers();
    h.append("set-cookie", "asid=old; Path=/");
    h.append("set-cookie", "asid=new; Path=/");
    jar.absorb(h);
    expect(jar.header()).toBe("asid=new");
  });
  it("deletes cookies with empty values", () => {
    const jar = new CookieJar();
    const h = new Headers();
    h.append("set-cookie", "gone=x; Path=/");
    jar.absorb(h);
    const h2 = new Headers();
    h2.append("set-cookie", "gone=; Path=/");
    jar.absorb(h2);
    expect(jar.has("gone")).toBe(false);
  });
});

describe("classifyAuthResponse", () => {
  it("recognizes success with puuid", () => {
    expect(classifyAuthResponse({ type: "success", success: { puuid: "p1" } })).toEqual({ kind: "success", puuid: "p1" });
  });
  it("recognizes multifactor challenge with masked email", () => {
    expect(classifyAuthResponse({ type: "multifactor", multifactor: { method: "email", email: "a***@b.com" } }))
      .toEqual({ kind: "mfa", maskedEmail: "a***@b.com" });
  });
  it("recognizes invalid OTP inside multifactor body", () => {
    const r = classifyAuthResponse({ type: "multifactor", multifactor: { error: "invalid_code" } });
    expect(r.kind).toBe("error");
    if (r.kind === "error") expect(r.message).toMatch(/Invalid verification code/);
  });
  it("surfaces other errors", () => {
    const r = classifyAuthResponse({ error: "invalid_credentials" });
    expect(r.kind).toBe("error");
    if (r.kind === "error") expect(r.message).toContain("invalid_credentials");
  });
  it("auth_failure message points at captcha + cookie fallback", () => {
    const r = classifyAuthResponse({ type: "auth", error: "auth_failure", country: "mng" });
    expect(r.kind).toBe("error");
    if (r.kind === "error") {
      expect(r.message).toMatch(/auth_failure/);
      expect(r.message).toMatch(/captcha/i);
      expect(r.message).toMatch(/AUTO LOGIN/);
    }
  });
});

describe("parseTokenLocation / isLoginRedirect", () => {
  it("parses access_token from the redirect fragment", () => {
    const loc = "https://playvalorant.com/opt_in#access_token=AT.123&scope=openid&token_type=Bearer&id_token=ID.456&expires_in=3600";
    expect(parseTokenLocation(loc)).toEqual({ accessToken: "AT.123", idToken: "ID.456" });
  });
  it("returns null without a fragment token", () => {
    expect(parseTokenLocation("https://playvalorant.com/opt_in")).toBeNull();
    expect(parseTokenLocation("https://playvalorant.com/opt_in#scope=openid")).toBeNull();
  });
  it("detects the failed-session login redirect", () => {
    expect(isLoginRedirect("https://authenticate.riotgames.com/login?client_id=play-valorant-web-prod")).toBe(true);
    expect(isLoginRedirect("https://playvalorant.com/opt_in#access_token=x")).toBe(false);
  });
});

describe("MFA sessions", () => {
  it("creates, reads, and destroys sessions", () => {
    const id = createSession({ jar: new CookieJar(), maskedEmail: "a***@b.c", puuid: null, createdAt: Date.now() });
    expect(getSession(id)?.maskedEmail).toBe("a***@b.c");
    destroySession(id);
    expect(getSession(id)).toBeNull();
  });
  it("expires sessions after the TTL", () => {
    vi.useFakeTimers();
    const id = createSession({ jar: new CookieJar(), maskedEmail: "", puuid: null, createdAt: Date.now() });
    vi.advanceTimersByTime(6 * 60_000);
    expect(getSession(id)).toBeNull();
    vi.useRealTimers();
  });
});

describe("rateLimit", () => {
  it("allows up to the limit then blocks", () => {
    const key = `test-${Math.random()}`;
    for (let i = 0; i < 5; i++) expect(rateLimit(key)).toBe(true);
    expect(rateLimit(key)).toBe(false);
  });
});

describe("AuthFlowError", () => {
  it("carries an http status", () => {
    const e = new AuthFlowError("msg", 429);
    expect(e.status).toBe(429);
    expect(e.message).toBe("msg");
    expect(e.details).toBeUndefined();
  });
  it("carries optional structured details (captcha challenge)", () => {
    const e = new AuthFlowError("fail", 401, { captchaRequired: true, sitekey: "sk", rqdata: "rd" });
    expect(e.details).toEqual({ captchaRequired: true, sitekey: "sk", rqdata: "rd" });
  });
});

describe("extractTokens (riot-client inline tokens)", () => {
  it("pulls tokens from a response parameters URI", () => {
    const t = extractTokens(
      '{"response":{"parameters":{"uri":"http://localhost/redirect#access_token=AT.1&id_token=ID.2&expires_in=3600"}}}'
    );
    expect(t).toEqual({ accessToken: "AT.1", idToken: "ID.2" });
  });
  it("pulls tokens from plain text", () => {
    expect(extractTokens("junk access_token=AAA&scope=openid id_token=BBB more")).toEqual({
      accessToken: "AAA",
      idToken: "BBB",
    });
  });
  it("returns null without access_token", () => {
    expect(extractTokens('{"type":"multifactor"}')).toBeNull();
  });
});

describe("normalizeRegion", () => {
  it("accepts known affinities case-insensitively", () => {
    expect(normalizeRegion("na")).toBe("na");
    expect(normalizeRegion("EU")).toBe("eu");
    expect(normalizeRegion("latam")).toBe("latam");
    expect(normalizeRegion("PBE")).toBe("na");
  });
  it("rejects garbage", () => {
    expect(normalizeRegion("nonsense")).toBeNull();
    expect(normalizeRegion(undefined)).toBeNull();
    expect(normalizeRegion(42)).toBeNull();
  });
});

describe("classifyAuthResponse bare multifactor", () => {
  it("detects multifactor bodies without a type field", () => {
    const r = classifyAuthResponse({ multifactor: { email: "a***@b.c" } });
    expect(r.kind).toBe("mfa");
    if (r.kind === "mfa") expect(r.maskedEmail).toBe("a***@b.c");
  });
});

describe("parseCookieInput (browser-cookie mode)", () => {
  it("treats a bare value as ssid", () => {
    expect(parseCookieInput("abc123XYZ")).toEqual([["ssid", "abc123XYZ"]]);
  });
  it("parses a single recognized pair", () => {
    expect(parseCookieInput("ssid=abc123")).toEqual([["ssid", "abc123"]]);
    expect(parseCookieInput("__cf_bm=xyz;")).toEqual([["__cf_bm", "xyz"]]);
  });
  it("parses a multi-cookie string", () => {
    expect(parseCookieInput("ssid=a; asid=b; tdid=c")).toEqual([
      ["ssid", "a"],
      ["asid", "b"],
      ["tdid", "c"],
    ]);
  });
  it("ignores malformed segments and handles empty input", () => {
    expect(parseCookieInput("ssid=a; broken")).toEqual([["ssid", "a"]]);
    expect(parseCookieInput("   ")).toEqual([]);
  });
  it("treats an unrecognized single pair as a bare ssid value", () => {
    // deliberate: bare values may themselves contain '=' (base64 padding),
    // so anything that isn't a known cookie name is assumed to BE the ssid
    expect(parseCookieInput("foo=bar")).toEqual([["ssid", "foo=bar"]]);
    expect(parseCookieInput("abc=")).toEqual([["ssid", "abc="]]);
  });
});

describe("loginWithCookies (browser-cookie mode)", () => {
  const ID_TOKEN = [
    "eyJhbGciOiJub25lIn0",
    Buffer.from(JSON.stringify({ sub: "puuid-abc-123" })).toString("base64url"),
    "sig",
  ].join(".");

  /** Stub global fetch with routing for every Riot/valorant-api URL the flow hits. */
  function mockRiotFetch(opts: { location?: string; geoLive?: string } = {}) {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("auth.riotgames.com/authorize")) {
        const headers: Record<string, string> = {};
        if (opts.location !== undefined) headers.Location = opts.location;
        return new Response(null, { status: 302, headers });
      }
      if (url.includes("entitlements.auth.riotgames.com")) {
        return new Response(JSON.stringify({ entitlements_token: "ENT.test" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("riot-geo")) {
        return new Response(JSON.stringify({ affinities: { live: opts.geoLive ?? "EU" } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("valorant-api.com/v1/version")) {
        return new Response(
          JSON.stringify({ data: { riotClientBuild: "test-build.1", riotClientVersion: "release-test" } }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      throw new Error(`unexpected fetch during test: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  function reauthHeaders(fetchMock: ReturnType<typeof mockRiotFetch>): Record<string, string> {
    const call = fetchMock.mock.calls.find(([u]) => String(u).includes("auth.riotgames.com/authorize"));
    expect(call, "reauth request missing").toBeTruthy();
    return (call![1]?.headers ?? {}) as Record<string, string>;
  }

  const successLocation = `https://playvalorant.com/opt_in#access_token=AT.test&scope=openid&token_type=Bearer&id_token=${ID_TOKEN}&expires_in=3600`;

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("mints tokens from a bare ssid value and auto-detects the region", async () => {
    const fetchMock = mockRiotFetch({ location: successLocation });
    const out = await loginWithCookies("abc123ssid");
    expect(out.kind).toBe("tokens");
    expect(out.accessToken).toBe("AT.test");
    expect(out.entitlementsToken).toBe("ENT.test");
    expect(out.puuid).toBe("puuid-abc-123");
    expect(out.region).toBe("eu");
    expect(reauthHeaders(fetchMock).Cookie).toBe("ssid=abc123ssid");
  });

  it("passes a full multi-cookie string through to the reauth request", async () => {
    const fetchMock = mockRiotFetch({ location: successLocation });
    const out = await loginWithCookies("ssid=a; asid=b; tdid=c");
    expect(out.accessToken).toBe("AT.test");
    expect(reauthHeaders(fetchMock).Cookie).toBe("ssid=a; asid=b; tdid=c");
  });

  it("rejects pastes without an ssid cookie before hitting Riot", async () => {
    const fetchMock = mockRiotFetch();
    const err = await loginWithCookies("asid=only").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AuthFlowError);
    expect((err as AuthFlowError).status).toBe(400);
    expect((err as AuthFlowError).message).toMatch(/ssid/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("remaps an expired session (login redirect) to a friendly 401", async () => {
    mockRiotFetch({ location: "https://authenticate.riotgames.com/login?client_id=play-valorant-web-prod" });
    const err = await loginWithCookies("ssid=stale").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AuthFlowError);
    expect((err as AuthFlowError).status).toBe(401);
    expect((err as AuthFlowError).message).toMatch(/playvalorant\.com again/);
  });

  it("remaps a reauth response with no token to a friendly 401", async () => {
    mockRiotFetch(); // no Location header at all
    const err = await loginWithCookies("ssid=dead").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AuthFlowError);
    expect((err as AuthFlowError).status).toBe(401);
    expect((err as AuthFlowError).message).toMatch(/playvalorant\.com again/);
  });
});
