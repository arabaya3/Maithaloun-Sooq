import { expect, test } from "@playwright/test";

import { expectNoHorizontalOverflow, login, trackPageIssues } from "./support";

const SHOTS = "artifacts/store-ops";

test("owner reads deterministic analytics on the phone and desktop", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const issues = trackPageIssues(page);
  await login(page);
  await page
    .getByRole("navigation", { name: "التنقل السفلي" })
    .getByRole("button", { name: "المزيد" })
    .click();
  await page
    .getByRole("dialog", { name: "المزيد" })
    .getByRole("link", { name: "التقارير" })
    .click();
  await expect(
    page.getByRole("heading", { name: "التقارير", level: 1 }),
  ).toBeVisible();

  const sales = page.getByRole("region", { name: "المبيعات والربح" });
  for (const label of [
    "إجمالي المبيعات",
    "صافي المبيعات",
    "تكلفة البضاعة المباعة",
    "الربح الإجمالي",
    "متوسط قيمة العملية",
  ]) {
    await expect(sales.getByText(label, { exact: true })).toBeVisible();
  }
  await expect(
    page.getByRole("region", { name: "الأكثر مبيعاً بالكمية" }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "البيع المباشر مقابل طلبات المتجر" }),
  ).toContainText("بيع مباشر");
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: `${SHOTS}/analytics-390.png`, fullPage: true });

  await page
    .getByRole("navigation", { name: "الفترة" })
    .getByRole("link", { name: "فترة محددة" })
    .click();
  await page.getByLabel("من تاريخ").fill("2020-01-01");
  await page.getByLabel("إلى تاريخ").fill("2020-01-31");
  await page.getByRole("button", { name: "عرض" }).click();
  await expect(page).toHaveURL(/from=2020-01-01/);
  await expect(page.getByText("لا توجد مبيعات في هذه الفترة.")).toBeVisible();

  for (const viewport of [
    { width: 360, height: 800 },
    { width: 768, height: 1024 },
    { width: 1024, height: 768 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/admin/reports?preset=month");
    await expect(
      page.getByRole("heading", { name: "التقارير", level: 1 }),
    ).toBeVisible();
    await expectNoHorizontalOverflow(page);
  }
  await page.screenshot({
    path: `${SHOTS}/analytics-1440.png`,
    fullPage: true,
  });

  expect(issues.consoleErrors).toEqual([]);
  expect(issues.failedRequests).toEqual([]);
});
