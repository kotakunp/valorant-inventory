import { describe, expect, it } from "vitest";
import { riotCookieHeader } from "./browserLogin";

const c = (name: string, value: string, domain: string) => ({ name, value, domain });

describe("riotCookieHeader", () => {
  it("serializes all Riot-domain cookies with a leading ssid", () => {
    const header = riotCookieHeader([
      c("ssid", "s1", ".riotgames.com"),
      c("asid", "a1", "auth.riotgames.com"),
      c("tdid", "t1", ".riotgames.com"),
    ]);
    expect(header).toBe("ssid=s1; asid=a1; tdid=t1");
  });
  it("returns empty string when no ssid is present", () => {
    expect(riotCookieHeader([c("tdid", "t1", ".riotgames.com")])).toBe("");
    expect(riotCookieHeader([])).toBe("");
  });
  it("filters non-Riot domains and empty values", () => {
    const header = riotCookieHeader([
      c("ssid", "s1", ".riotgames.com"),
      c("session", "xyz", "playvalorant.com"),
      c("asid", "", ".riotgames.com"),
    ]);
    expect(header).toBe("ssid=s1");
  });
  it("keeps cookies whose value merely resembles another domain noise", () => {
    const header = riotCookieHeader([c("ssid", "s1", "auth.riotgames.com")]);
    expect(header).toBe("ssid=s1");
  });
});
