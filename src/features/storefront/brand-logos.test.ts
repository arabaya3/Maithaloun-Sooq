import { existsSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { brandLogo } from "./brand-logos";

describe("brand logos", () => {
  it("covers only the five verified logos, matched on the owner's brand name", () => {
    for (const name of [
      "Clear",
      "AXE",
      "Head & Shoulders",
      "Signal",
      "Sunsilk",
    ]) {
      const logo = brandLogo(name);
      expect(logo, name).not.toBeNull();
      expect(existsSync(path.join("public", logo!.src))).toBe(true);
    }
    expect(brandLogo(" head & shoulders ")).not.toBeNull();
  });

  it("falls back to a wordmark for every other brand", () => {
    for (const name of ["Finish", "Dove", "Ariel", "Pampers", "Arar", "لميس"]) {
      expect(brandLogo(name), name).toBeNull();
    }
  });
});
