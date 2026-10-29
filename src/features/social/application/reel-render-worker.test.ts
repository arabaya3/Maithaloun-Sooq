import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const read = (file: string) =>
  readFileSync(path.join(process.cwd(), file), "utf8");

function imports(source: string): string[] {
  return [...source.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]!);
}

/** What would let the worker publish, approve or reach a social account. */
const PUBLISHING =
  /social-service|social-factory|social-instance|social-actions|publisher|make-|meta-|token-vault/;

describe("the render-only Reels worker", () => {
  it("loads nothing that can publish, approve or reach a social account", () => {
    for (const file of [
      "tools/social-render-worker.ts",
      "src/features/social/application/reel-render-worker.ts",
      "src/features/social/application/reel-render-queue.ts",
    ]) {
      const found = imports(read(file)).filter((name) => PUBLISHING.test(name));
      expect(found, file).toEqual([]);
    }
  });

  it("is off unless the owner turns it on, and its workflow carries no social secrets", () => {
    expect(read("tools/social-render-worker.ts")).toContain(
      'process.env.REELS_RENDER_WORKER !== "on"',
    );
    const workflow = read(".github/workflows/reels-render-worker.yml");
    expect(workflow).toContain("workflow_dispatch");
    expect(workflow).not.toMatch(/^\s*schedule:/m);
    expect(workflow).toContain("vars.REELS_RENDER_WORKER == 'on'");
    expect(workflow).not.toMatch(/MAKE_|META_|FACEBOOK|INSTAGRAM|TOKEN_VAULT/);
  });
});
