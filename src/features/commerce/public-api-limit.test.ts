import { describe, expect, it } from "vitest";

import {
  publicApiBuckets,
  publicApiClientKey,
  SHARED_BUDGET_MULTIPLIER,
} from "./public-api-limit";

const forged = new Headers({
  "x-forwarded-for": "203.0.113.7, 10.0.0.1",
  "x-real-ip": "203.0.113.8",
});

describe("public API client address", () => {
  it("ignores forwarded headers unless a proxy that overwrites them is in front", () => {
    expect(
      publicApiClientKey(forged, { trustProxy: false, onVercel: false }),
    ).toBeNull();
  });

  it("uses Vercel's overwritten x-forwarded-for, or an approved proxy's", () => {
    expect(
      publicApiClientKey(forged, { trustProxy: false, onVercel: true }),
    ).toBe("203.0.113.7");
    expect(
      publicApiClientKey(forged, { trustProxy: true, onVercel: false }),
    ).toBe("203.0.113.7");
  });

  it("rejects an oversized address instead of using it as a key", () => {
    const long = new Headers({ "x-forwarded-for": "x".repeat(200) });
    expect(
      publicApiClientKey(long, { trustProxy: false, onVercel: true }),
    ).toBeNull();
  });
});

describe("public API buckets", () => {
  it("counts a known client against its own budget and the shared ceiling", () => {
    expect(publicApiBuckets("203.0.113.7", 60)).toEqual([
      { key: "client:203.0.113.7", limit: 60 },
      { key: "all", limit: 60 * SHARED_BUDGET_MULTIPLIER },
    ]);
  });

  it("puts clients without a trusted address in the shared bucket only", () => {
    expect(publicApiBuckets(null, 60)).toEqual([
      { key: "all", limit: 60 * SHARED_BUDGET_MULTIPLIER },
    ]);
  });
});
