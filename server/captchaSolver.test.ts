import { describe, expect, it } from "vitest";
import { captchaSolverEnabled } from "./captchaSolver";

describe("captchaSolver config", () => {
  it("is disabled when CAPMONSTER_API_KEY is unset", () => {
    const prev = process.env.CAPMONSTER_API_KEY;
    delete process.env.CAPMONSTER_API_KEY;
    expect(captchaSolverEnabled()).toBe(false);
    if (prev !== undefined) process.env.CAPMONSTER_API_KEY = prev;
  });

  it("is enabled when CAPMONSTER_API_KEY is set", () => {
    const prev = process.env.CAPMONSTER_API_KEY;
    process.env.CAPMONSTER_API_KEY = "test-key";
    expect(captchaSolverEnabled()).toBe(true);
    if (prev === undefined) delete process.env.CAPMONSTER_API_KEY;
    else process.env.CAPMONSTER_API_KEY = prev;
  });
});
