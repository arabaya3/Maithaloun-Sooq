import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const source = readFileSync(join(process.cwd(), "src/app/sw.ts"), "utf8");

describe("service worker caching", () => {
  it("never caches navigations or account, API and checkout responses", () => {
    expect(source).toMatch(
      /request\.mode === "navigate",\s+handler: new NetworkOnly\(\)/,
    );
    for (const prefix of ["/api/", "/account", "/checkout", "/orders/"]) {
      expect(source).toContain(`"${prefix}"`);
    }
    expect(source).toMatch(
      /matcher: \/\.\*\/,\s+method: "GET",\s+handler: new NetworkOnly\(\)/,
    );
  });
});
