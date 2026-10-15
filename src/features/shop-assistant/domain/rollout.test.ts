import { describe, expect, it } from "vitest";

import { assistantAnswers, parseAllowlist } from "./rollout";

describe("assistant rollout allowlist", () => {
  it("answers everyone when no allowlist is set", () => {
    expect(parseAllowlist(undefined)).toBeNull();
    expect(parseAllowlist("  ")).toBeNull();
    expect(assistantAnswers("+970591234567", null)).toBe(true);
  });

  it("answers only listed numbers while an allowlist is set", () => {
    const list = parseAllowlist("+972 599-105-456, +970591234567");
    expect(assistantAnswers("+972599105456", list)).toBe(true);
    expect(assistantAnswers("+970591234567", list)).toBe(true);
    expect(assistantAnswers("+970599999999", list)).toBe(false);
  });

  it("answers nobody if the allowlist is set but has no valid number", () => {
    const list = parseAllowlist("owner-phone");
    expect(list?.size).toBe(0);
    expect(assistantAnswers("+970591234567", list)).toBe(false);
  });
});
