import { describe, expect, it } from "vitest";
import { makeState, parseCallback } from "./rso";

describe("makeState", () => {
  it("returns a non-empty unique value", () => {
    const a = makeState();
    const b = makeState();
    expect(a.length).toBeGreaterThan(8);
    expect(a).not.toBe(b);
  });
});

describe("parseCallback", () => {
  it("is none when there is no callback content", () => {
    expect(parseCallback("", null)).toEqual({ kind: "none" });
    expect(parseCallback("?foo=bar", "s1")).toEqual({ kind: "none" });
  });
  it("returns the code when state matches", () => {
    expect(parseCallback("?code=abc123&state=s1", "s1")).toEqual({ kind: "code", code: "abc123" });
  });
  it("rejects a state mismatch", () => {
    const r = parseCallback("?code=abc123&state=evil", "s1");
    expect(r.kind).toBe("error");
    if (r.kind === "error") expect(r.message).toMatch(/state mismatch/);
  });
  it("rejects a missing saved state", () => {
    expect(parseCallback("?code=abc123&state=x", null).kind).toBe("error");
  });
  it("surfaces OAuth error responses", () => {
    const r = parseCallback("?error=access_denied&error_description=User+cancelled", null);
    expect(r).toEqual({ kind: "error", message: "User cancelled" });
  });
});
