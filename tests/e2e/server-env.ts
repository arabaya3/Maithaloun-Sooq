import type { TestEnv } from "../../src/server/env/env-schema";

// The one environment every e2e server gets, in development or as a production build.
export function e2eServerEnvironment(
  testEnvironment: TestEnv,
  origin: string,
): Record<string, string> {
  return {
    DATABASE_URL: testEnvironment.TEST_DATABASE_URL,
    ORDER_RATE_LIMIT_PEPPER: testEnvironment.ORDER_RATE_LIMIT_PEPPER,
    APP_ORIGIN: origin,
    AI_FAKE_MODE: "1",
    ADMIN_ASSISTANT: "full",
    CRON_SECRET: "e2e-cron-secret-0123456789abcdef0123456789",
    OPENAI_API_KEY: "",
    SUPABASE_URL: "",
    SUPABASE_SECRET_KEY: "",
    CUSTOMER_ACCOUNTS: "on",
    CUSTOMER_OTP_PROVIDER: "development",
    CUSTOMER_OTP_DEV_CODE: "246810",
    QA_STOCK_SIMULATION: "on",
  };
}
