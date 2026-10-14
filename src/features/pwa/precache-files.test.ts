import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("service worker precache", () => {
  it("lists only public files that exist, so renamed icons cannot break installation", () => {
    const config = readFileSync("next.config.ts", "utf8");
    const files = [...config.matchAll(/url: "(\/brand\/[^"]+)"/g)].map(
      (match) => match[1]!,
    );
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      expect(existsSync(path.join("public", file)), file).toBe(true);
    }
  });
});
