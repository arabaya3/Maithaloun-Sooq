import { config as loadEnvironment } from "dotenv";
import { defineConfig, devices } from "@playwright/test";

import { parseTestEnv } from "./src/server/env/env-schema";

loadEnvironment({ path: ".env.local", quiet: true });
const testEnvironment = parseTestEnv({
  DATABASE_URL: process.env.DATABASE_URL,
  TEST_DATABASE_URL: process.env.TEST_DATABASE_URL,
  ORDER_RATE_LIMIT_PEPPER: process.env.ORDER_RATE_LIMIT_PEPPER,
  APP_ORIGIN: process.env.APP_ORIGIN,
});

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "mobile-chromium",
      use: { ...devices["Pixel 5"], viewport: { width: 390, height: 844 } },
    },
  ],
  webServer: {
    command: "npx --yes pnpm@12.5.1 dev",
    url: "http://localhost:3000",
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      DATABASE_URL: testEnvironment.TEST_DATABASE_URL,
      ORDER_RATE_LIMIT_PEPPER: testEnvironment.ORDER_RATE_LIMIT_PEPPER,
      APP_ORIGIN: testEnvironment.APP_ORIGIN,
    },
  },
});
