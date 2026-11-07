// Builds the app the way a Vercel Preview deployment does: no server secrets at all.
// Storefront pages must then skip build-time prerendering instead of failing (see canPrerenderWithData).
// Usage: pnpm build:no-env
import { spawnSync } from "node:child_process";
import path from "node:path";

// Next loads .env.local for any variable that is not already set; empty values keep them unset for the
// schema without letting the file fill them in.
const SERVER_SECRETS = [
  "DATABASE_URL",
  "APP_ORIGIN",
  "ORDER_RATE_LIMIT_PEPPER",
  "TEST_DATABASE_URL",
  "SUPABASE_URL",
  "SUPABASE_SECRET_KEY",
  "OPENAI_API_KEY",
  "CRON_SECRET",
];

const environment: NodeJS.ProcessEnv = {
  ...process.env,
  VERCEL_ENV: "preview",
};
for (const name of SERVER_SECRETS) environment[name] = "";

const result = spawnSync(
  process.execPath,
  [path.resolve("node_modules/next/dist/bin/next"), "build", "--webpack"],
  { stdio: "inherit", env: environment },
);
process.exit(result.status ?? 1);
