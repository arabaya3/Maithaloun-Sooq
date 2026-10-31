// Full e2e suite against the dev server: one fresh test database, a new `next dev` for each batch of specs.
// One server cannot last the whole run: webpack's heap reaches Next's restart threshold and tests in flight fail.
// Usage: pnpm test:e2e:full
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";

const SPECS_PER_BATCH = 5;
// Opens every admin screen at every width, which fills most of a heap by itself.
const RUNS_ALONE = "zz-visual-qa.spec.ts";
const isWindows = process.platform === "win32";

function run(command: string, args: string[]) {
  return spawnSync(command, args, {
    stdio: "inherit",
    // pnpm is a .cmd shim on Windows; node runs directly so paths with spaces stay intact.
    shell: isWindows && command === "pnpm",
  }).status;
}

// Sorted as Playwright sorts them, so specs run in the same order as one `playwright test`.
const specs = readdirSync("tests/e2e")
  .filter((file) => file.endsWith(".spec.ts"))
  .sort();
const batches: string[][] = [];
let current: string[] = [];
for (const spec of specs) {
  if (spec === RUNS_ALONE) {
    if (current.length > 0) batches.push(current);
    batches.push([spec]);
    current = [];
    continue;
  }
  current.push(spec);
  if (current.length === SPECS_PER_BATCH) {
    batches.push(current);
    current = [];
  }
}
if (current.length > 0) batches.push(current);

for (const script of ["db:test:up", "db:test:prepare"]) {
  if (run("pnpm", [script]) !== 0) {
    console.error(`pnpm ${script} failed`);
    process.exit(1);
  }
}

const failed: number[] = [];
batches.forEach((batch, index) => {
  const number = index + 1;
  console.log(`\nBatch ${number} of ${batches.length}: ${batch.join(" ")}`);
  const status = run(process.execPath, [
    path.resolve("node_modules/@playwright/test/cli.js"),
    "test",
    // Playwright empties its output folder when it starts; one folder each keeps earlier traces.
    `--output=test-results/batch-${number}`,
    ...batch.map((spec) => `tests/e2e/${spec}`),
  ]);
  if (status !== 0) failed.push(number);
});

if (failed.length > 0) {
  console.error(`\nE2e batches failed: ${failed.join(", ")}`);
  process.exit(1);
}
console.log(`\nAll ${batches.length} e2e batches passed.`);
