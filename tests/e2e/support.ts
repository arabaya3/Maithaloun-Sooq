import { config as loadEnvironment } from "dotenv";
import { expect, type Page } from "@playwright/test";
import postgres from "postgres";

import { parseTestEnv } from "../../src/server/env/env-schema";
import { parseTestAdminEnv } from "../../src/test/test-admin";

loadEnvironment({ path: ".env.local", quiet: true });

export const environment = parseTestEnv({
  DATABASE_URL: process.env.DATABASE_URL,
  TEST_DATABASE_URL: process.env.TEST_DATABASE_URL,
  ORDER_RATE_LIMIT_PEPPER: process.env.ORDER_RATE_LIMIT_PEPPER,
  APP_ORIGIN: process.env.APP_ORIGIN,
  TRUST_PROXY: process.env.TRUST_PROXY,
});

export const admin = parseTestAdminEnv({
  TEST_ADMIN_USERNAME: process.env.TEST_ADMIN_USERNAME,
  TEST_ADMIN_PASSWORD: process.env.TEST_ADMIN_PASSWORD,
  TEST_ADMIN_DISPLAY_NAME: process.env.TEST_ADMIN_DISPLAY_NAME,
});

export const IPHONE_USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

export function trackPageIssues(page: Page) {
  const consoleErrors: string[] = [];
  const failedRequests: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("requestfailed", (request) => {
    if (request.failure()?.errorText === "net::ERR_ABORTED") return;
    failedRequests.push(`${request.method()} ${request.url()}`);
  });
  return { consoleErrors, failedRequests };
}

export async function withTestDb<T>(
  run: (sql: postgres.Sql) => Promise<T>,
): Promise<T> {
  const sql = postgres(environment.TEST_DATABASE_URL, {
    max: 1,
    prepare: false,
  });
  try {
    return await run(sql);
  } finally {
    await sql.end();
  }
}

export async function loginAs(
  page: Page,
  credentials: { username: string; password: string },
) {
  await page.goto("/admin");
  if (page.url().includes("/admin/login")) {
    await page.getByLabel("اسم المستخدم").fill(credentials.username);
    await page.getByLabel("كلمة المرور").fill(credentials.password);
    await page
      .getByRole("button", { name: "دخول الإدارة" })
      .click({ force: true });
  }
  await expect(
    page.getByRole("heading", { name: "اليوم", level: 1 }),
  ).toBeVisible({ timeout: 20_000 });
}

export async function login(page: Page) {
  await loginAs(page, {
    username: admin.TEST_ADMIN_USERNAME,
    password: admin.TEST_ADMIN_PASSWORD,
  });
}

export async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
}

export async function dispatchInstallPrompt(page: Page) {
  await page.evaluate(() => {
    const event = new Event("beforeinstallprompt", { cancelable: true });
    Object.assign(event, {
      prompt: () => Promise.resolve(),
      userChoice: Promise.resolve({ outcome: "dismissed" }),
    });
    window.dispatchEvent(event);
  });
}
