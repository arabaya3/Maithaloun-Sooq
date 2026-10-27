/**
 * Live contract test of the Make scenario. It cannot publish: it sends only unauthenticated or
 * wrong-key requests and, with --scenario-active, one authenticated request with an invalid
 * contentType that the scenario must answer 422 before its Facebook module.
 *
 *   pnpm social:make-contract --confirm [--scenario-active]
 *
 * Reads MAKE_WEBHOOK_URL and MAKE_WEBHOOK_API_KEY from the environment; prints the host only.
 */
import { config } from "dotenv";

import {
  runMakeContract,
  webhookHost,
} from "../src/features/social/infrastructure/make-contract";
import { makeConfigProblems } from "../src/features/social/infrastructure/make-publisher";

config({ path: ".env.local", quiet: true });

if (!process.argv.includes("--confirm")) {
  console.error("This calls the live Make webhook. Add --confirm to proceed.");
  process.exit(2);
}
const problems = makeConfigProblems(process.env);
if (problems.length) {
  console.error(`Make is not configured: ${problems.join(", ")}`);
  process.exit(2);
}
const scenarioActive = process.argv.includes("--scenario-active");
const checks = await runMakeContract({
  webhookUrl: process.env.MAKE_WEBHOOK_URL!,
  apiKey: process.env.MAKE_WEBHOOK_API_KEY!,
  scenarioActive,
});
console.log(`Make webhook host: ${webhookHost(process.env.MAKE_WEBHOOK_URL!)}`);
for (const check of checks) {
  console.log(
    `${check.passed ? "PASS" : "FAIL"}  ${check.name}: got ${check.status ?? "no answer"}, expected ${check.expected}`,
  );
}
if (!scenarioActive) {
  console.log(
    "SKIP  invalid contentType → 422: the scenario must be active (an inactive scenario queues requests).",
  );
}
process.exitCode = checks.every((check) => check.passed) ? 0 : 1;
