import { describe, expect, it } from "vitest";
import { status, __resetRemoteBrowserForTests, stopRemoteBrowser } from "./remoteBrowser";

describe("remote browser status", () => {
  it("reports expired when no session", () => {
    __resetRemoteBrowserForTests();
    const st = status();
    expect(st.active).toBe(false);
    expect(st.phase).toBe("expired");
  });

  it("stopRemoteBrowser is safe with no session", async () => {
    await expect(stopRemoteBrowser()).resolves.toBeUndefined();
  });
});
