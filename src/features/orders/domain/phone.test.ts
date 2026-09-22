import { describe, expect, it } from "vitest";

import {
  buildWhatsAppContactUrl,
  formatWhatsAppDisplay,
  normalizePalestinianPhone,
  normalizeWhatsAppPhone,
} from "./phone";

describe("WhatsApp phone normalization", () => {
  it.each([
    ["970", "0591234567", "+970591234567"],
    ["970", "056 123 4567", "+970561234567"],
    ["970", "٥٩١٢٣٤٥٦٧", "+970591234567"],
    ["970", "591234567", "+970591234567"],
    ["972", "0521234567", "+972521234567"],
    ["972", "52-123-4567", "+972521234567"],
    ["972", "٠٥٢١٢٣٤٥٦٧", "+972521234567"],
  ])("normalizes %s / %s", (country, input, expected) => {
    expect(normalizeWhatsAppPhone(country as "970" | "972", input)).toBe(
      expected,
    );
  });

  it.each([
    ["970", ""],
    ["970", "12345"],
    ["970", "05912345678"],
    ["970", "059-ABC-4567"],
    ["970", "0412345678"],
    ["972", "123"],
    ["972", "0412345678"],
  ])("rejects %s / %s", (country, input) => {
    expect(normalizeWhatsAppPhone(country as "970" | "972", input)).toBeNull();
  });

  it("builds a safe WhatsApp contact URL", () => {
    expect(
      buildWhatsAppContactUrl("+970591234567", "MS-abcdefghijklmnopqrstuvwx"),
    ).toBe(
      "https://wa.me/970591234567?text=" +
        encodeURIComponent(
          "مرحباً، بخصوص طلبك MS-abcdefghijklmnopqrstuvwx في سوق ميثلون",
        ),
    );
    expect(buildWhatsAppContactUrl("+441234567890", "MS-x")).toBeNull();
  });

  it("formats display numbers without exposing invalid values specially", () => {
    expect(formatWhatsAppDisplay("+972521234567")).toBe("+972 521234567");
  });
});

describe("legacy Palestinian phone normalization", () => {
  it.each([
    ["0591234567", "+970591234567"],
    ["+970-59-123-4567", "+970591234567"],
    ["00970561234567", "+970561234567"],
    ["+972521234567", "+972521234567"],
    ["00972521234567", "+972521234567"],
  ])("normalizes %s", (input, expected) => {
    expect(normalizePalestinianPhone(input)).toBe(expected);
  });

  it.each(["", "12345", "05912345678", "059-ABC-4567", "+44111", "0412345678"])(
    "rejects %s",
    (input) => {
      expect(normalizePalestinianPhone(input)).toBeNull();
    },
  );
});
