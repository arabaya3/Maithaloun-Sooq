import { config as loadEnvironment } from "dotenv";
import { defineConfig, devices } from "@playwright/test";

import { parseTestEnv } from "./src/server/env/env-schema";
import { e2eServerEnvironment } from "./tests/e2e/server-env";

loadEnvironment({ path: ".env.local", quiet: true });
const testEnvironment = parseTestEnv({
  DATABASE_URL: process.env.DATABASE_URL,
  TEST_DATABASE_URL: process.env.TEST_DATABASE_URL,
  ORDER_RATE_LIMIT_PEPPER: process.env.ORDER_RATE_LIMIT_PEPPER,
  APP_ORIGIN: process.env.APP_ORIGIN,
});

const port = Number(process.env.E2E_PORT ?? 3000);
const origin = `http://localhost:${port}`;
// tools/e2e-production.ts starts a production build itself and points the suite at it.
const external = process.env.E2E_EXTERNAL_SERVER === "1";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: "list",
  // The dev server compiles each route on first visit, which can exceed the 5s default.
  expect: { timeout: 15_000 },
  use: {
    baseURL: origin,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "mobile-chromium",
      use: { ...devices["Pixel 5"], viewport: { width: 390, height: 844 } },
    },
  ],
  webServer: external
    ? undefined
    : {
        command: `node ./node_modules/next/dist/bin/next dev --webpack -p ${port}`,
        url: origin,
        reuseExistingServer: false,
        timeout: 180_000,
        env: e2eServerEnvironment(
          testEnvironment,
          process.env.E2E_PORT ? origin : testEnvironment.APP_ORIGIN,
        ),
      },
});
