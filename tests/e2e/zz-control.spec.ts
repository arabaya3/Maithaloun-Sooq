import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import {
  expectNoHorizontalOverflow,
  login,
  loginAs,
  trackPageIssues,
  withTestDb,
} from "./support";

// Runs after inventory.spec, which creates this operator account.
const OPERATOR = {
  username: "e2e-operator",
  password: "Operator-e2e-pass-2026",
};
const SHOTS = "artifacts/admin-control";
const WIDTHS = [
  [360, 800],
  [390, 844],
  [768, 1024],
  [1440, 900],
] as const;

test.describe.configure({ mode: "serial" });

async function axe(page: Page) {
  const result = await new AxeBuilder({ page })
    .include("main")
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(
    result.violations.map((violation) => ({
      id: violation.id,
      nodes: violation.nodes.map((node) => node.target.join(" ")),
    })),
  ).toEqual([]);
}

test("an operator cannot open accounts or the audit log and never sees summaries", async ({
  page,
}) => {
  const issues = trackPageIssues(page);
  await withTestDb(
    (sql) => sql`
      insert into admin_notifications (type, title, body, href, dedupe_key)
      values ('business_summary', 'الملخص الشهري', 'المبيعات 900 ₪، الربح الإجمالي 210 ₪',
        '/admin/reports/archive', 'e2e-control-summary')
      on conflict (dedupe_key) do nothing
    `,
  );
  await loginAs(page, OPERATOR);
  await page.goto("/admin/settings/users");
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto("/admin/audit");
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto("/admin/notifications");
  await expect(
    page.getByRole("heading", { name: "الإشعارات", level: 1 }),
  ).toBeVisible();
  await expect(page.getByText("الربح الإجمالي 210")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "ملخصات" })).toHaveCount(0);
  expect(issues.consoleErrors).toEqual([]);
});

test("owner sees the summary, ends the operator's device, stops and restores the account", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const issues = trackPageIssues(page);
  await login(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/admin/notifications?filter=business_summary");
  await expect(page.getByText("الربح الإجمالي 210")).toBeVisible();

  await page.goto("/admin/settings");
  await page.getByRole("link", { name: "المستخدمون والجلسات" }).click();
  await expect(page).toHaveURL(/\/admin\/settings\/users$/);
  const ownerCard = page.getByRole("listitem", { name: /^حساب .*/ }).filter({
    hasText: "المالك",
  });
  await expect(ownerCard.getByText("هذا الجهاز")).toBeVisible();
  const operatorCard = page.getByRole("listitem", {
    name: "حساب موظفة الاختبار",
  });
  // The operator signed in during the previous test; that device can be signed out here.
  await operatorCard
    .getByRole("button", { name: /^إنهاء جهاز/ })
    .first()
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "تم إنهاء جلسة الجهاز." }),
  ).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/users-390.png`, fullPage: true });

  await operatorCard
    .getByRole("button", { name: "إيقاف حساب موظفة الاختبار" })
    .click();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "تم إيقاف الحساب وإنهاء كل جلساته." }),
  ).toBeVisible();
  await expect(operatorCard.getByText("موقوف")).toBeVisible();
  await operatorCard
    .getByRole("button", { name: "تفعيل حساب موظفة الاختبار" })
    .click();
  await expect(operatorCard.getByText("فعّال", { exact: true })).toBeVisible();

  await page.goto("/admin/audit");
  await page.getByRole("button", { name: /^تصفية/ }).click();
  const sheet = page.getByRole("dialog", { name: "تصفية السجل" });
  await sheet.getByLabel("النوع").selectOption({ label: "حساب" });
  await sheet.getByRole("button", { name: "تطبيق التصفية" }).click();
  const events = page.getByRole("region", { name: "أحداث السجل" });
  await expect(events.getByText("إنهاء جلسة جهاز").first()).toBeVisible();
  await expect(events.getByText("إيقاف حساب موظفة").first()).toBeVisible();
  await expect(events.getByText("تفعيل حساب موظفة").first()).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/audit-390.png`, fullPage: true });
  expect(issues.consoleErrors).toEqual([]);
  expect(issues.failedRequests).toEqual([]);
});

test("control pages fit 360 to 1440 and pass axe", async ({ page }) => {
  test.setTimeout(150_000);
  const issues = trackPageIssues(page);
  await login(page);
  const pages = [
    ["settings", "/admin/settings"],
    ["users", "/admin/settings/users"],
    ["audit", "/admin/audit"],
    ["notifications", "/admin/notifications"],
  ] as const;
  for (const [width, height] of WIDTHS) {
    await page.setViewportSize({ width, height });
    for (const [key, path] of pages) {
      await page.goto(path);
      await expect(page.locator("main h1")).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await axe(page);
      await page.screenshot({ path: `${SHOTS}/${key}-${width}.png` });
    }
  }
  expect(issues.consoleErrors).toEqual([]);
  expect(issues.failedRequests).toEqual([]);
});
