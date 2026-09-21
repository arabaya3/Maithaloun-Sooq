import { describe, expect, it } from "vitest";

import { normalizePalestinianPhone } from "./phone";

describe("Palestinian phone normalization", () => {
  it.each([
    ["0591234567", "+970591234567"],
    ["056 123 4567", "+970561234567"],
    ["+970-59-123-4567", "+970591234567"],
    ["00970561234567", "+970561234567"],
    ["970591234567", "+970591234567"],
  ])("normalizes %s", (input, expected) => {
    expect(normalizePalestinianPhone(input)).toBe(expected);
  });

  it.each([
    "",
    "12345",
    "0581234567",
    "+972591234567",
    "05912345678",
    "059-ABC-4567",
  ])("rejects %s", (input) => {
    expect(normalizePalestinianPhone(input)).toBeNull();
  });
});
