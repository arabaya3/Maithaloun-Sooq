import { expect, test } from "@playwright/test";

import {
  expectNoHorizontalOverflow,
  login,
  trackPageIssues,
  withTestDb,
} from "./support";

const QUESTIONS = 6;

for (const viewport of [
  { width: 360, height: 800 },
  { width: 390, height: 844 },
]) {
  test(`owner smoke test runs read-only questions at ${viewport.width}x${viewport.height}`, async ({
    page,
  }) => {
    const issues = trackPageIssues(page);
    await page.setViewportSize(viewport);
    await login(page);
    const cardsBefore = await withTestDb(
      (sql) =>
        sql<
          { n: number }[]
        >`select count(*)::int as n from admin_assistant_confirmations`,
    );

    await page.goto("/admin/assistant-smoke");
    await expect(
      page.getByRole("heading", { level: 1, name: "فحص المساعد" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "تشغيل الفحص" }).click();
    const results = page.getByRole("status");
    await expect(results).toContainText(`من ${QUESTIONS}`);
    await expect(page.locator(".admin-smoke-item")).toHaveCount(QUESTIONS);
    await expect(
      page.getByRole("listitem", { name: "شو المنتجات اللي قربت تخلص؟" }),
    ).toContainText("getLowStockItems");
    await expect(page.locator(".admin-smoke-item").first()).toContainText(
      "رموز:",
    );
    const box = await page
      .getByRole("button", { name: "تشغيل الفحص" })
      .boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    await expectNoHorizontalOverflow(page);

    const cardsAfter = await withTestDb(
      (sql) =>
        sql<
          { n: number }[]
        >`select count(*)::int as n from admin_assistant_confirmations`,
    );
    expect(cardsAfter[0]!.n).toBe(cardsBefore[0]!.n);
    expect(issues.consoleErrors).toEqual([]);
    expect(issues.failedRequests).toEqual([]);
  });
}

test("the smoke endpoint refuses requests from another origin", async ({
  page,
}) => {
  await login(page);
  const status = await page.evaluate(async () => {
    const response = await fetch("/admin/api/assistant/smoke", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
      referrerPolicy: "no-referrer",
      mode: "same-origin",
    });
    return response.status;
  });
  expect(status).toBe(200);
  const forged = await page.request.post("/admin/api/assistant/smoke", {
    headers: { Origin: "https://evil.example", "Sec-Fetch-Site": "cross-site" },
    data: {},
  });
  expect(forged.status()).toBe(401);
});
