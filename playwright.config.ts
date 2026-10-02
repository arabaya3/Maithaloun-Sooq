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

const port = Number(process.env.E2E_PORT ?? 3000);
const origin = `http://localhost:${port}`;

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
  webServer: {
    command: `node ./node_modules/next/dist/bin/next dev --webpack -p ${port}`,
    url: origin,
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      DATABASE_URL: testEnvironment.TEST_DATABASE_URL,
      ORDER_RATE_LIMIT_PEPPER: testEnvironment.ORDER_RATE_LIMIT_PEPPER,
      APP_ORIGIN: process.env.E2E_PORT ? origin : testEnvironment.APP_ORIGIN,
      AI_FAKE_MODE: "1",
      ADMIN_ASSISTANT: "full",
      CRON_SECRET: "e2e-cron-secret-0123456789abcdef0123456789",
      OPENAI_API_KEY: "",
      SUPABASE_URL: "",
      SUPABASE_SECRET_KEY: "",
      CUSTOMER_ACCOUNTS: "on",
      CUSTOMER_OTP_PROVIDER: "development",
      CUSTOMER_OTP_DEV_CODE: "246810",
    },
  },
});
