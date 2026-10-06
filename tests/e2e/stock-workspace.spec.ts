import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { expectNoHorizontalOverflow, login, trackPageIssues } from "./support";

const SHOTS = "artifacts/admin-inventory";
const SUPPLIER = "مورد لوحة المخزون";
const WIDTHS = [
  [360, 800],
  [390, 844],
  [768, 1024],
  [1440, 900],
] as const;

test.describe.configure({ mode: "serial" });

let invoicePath = "";
let supplierPath = "";

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

async function stickyClear(page: Page) {
  const sticky = (await page.locator(".admin-sticky-action").boundingBox())!;
  const nav = (await page
    .getByRole("navigation", { name: "التنقل السفلي" })
    .boundingBox())!;
  expect(sticky.y + sticky.height).toBeLessThanOrEqual(nav.y + 1);
  const launcher = page.getByRole("button", { name: "فتح المساعد" });
  if (await launcher.isVisible()) {
    const box = (await launcher.boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(sticky.y);
  }
}

test("an unpaid purchase shows its recorded stock effect and leads to the supplier payment", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const issues = trackPageIssues(page);
  await login(page);
  await page.setViewportSize({ width: 390, height: 844 });

  // The general cleaner sells at 7 ₪; buying it at 8 ₪ is a real loss the home page must flag.
  await page.goto("/admin/inventory/purchases/new");
  await page.getByRole("combobox", { name: "المورد" }).selectOption({
    label: "+ مورد جديد",
  });
  await page.getByLabel("اسم المورد الجديد").fill(SUPPLIER);
  await page.getByLabel("رقم الفاتورة (اختياري)").fill("E2E-WS-1");
  await page.getByRole("button", { name: /منتج السطر 1/ }).click();
  const picker = page.getByRole("dialog", { name: "منتج السطر 1" });
  await picker.getByRole("searchbox", { name: "بحث عن منتج" }).fill("منظف عام");
  await picker
    .getByRole("button")
    .filter({ hasText: "منظف عام" })
    .first()
    .click();
  await page.getByLabel(/^الكمية/).fill("3");
  await page.getByLabel(/سعر الشراء/).fill("8");
  await page.getByRole("radio", { name: "غير مدفوعة" }).check();
  await page.getByRole("button", { name: "مراجعة الفاتورة" }).click();
  await page.getByRole("button", { name: "تأكيد وحفظ في المخزون" }).click();
  await page.getByRole("link", { name: "عرض الفاتورة" }).click();
  await expect(page).toHaveURL(/\/admin\/inventory\/purchases\/[0-9a-f-]+$/);
  invoicePath = new URL(page.url()).pathname;

  const effect = page.getByRole("region", { name: "أثرها على المخزون" });
  await expect(effect).toContainText("+3");
  await expect(effect).toContainText("الرصيد بعدها 3");
  await expect(effect).toContainText("متوسط التكلفة 8");
  const pay = page.getByRole("link", { name: "حساب المورد وتسجيل دفعة" });
  await stickyClear(page);
  await page.screenshot({ path: `${SHOTS}/purchase-390.png` });
  await pay.click();
  await expect(page).toHaveURL(/\/admin\/inventory\/suppliers\/.+#payment$/);
  supplierPath = new URL(page.url()).pathname;
  await expect(
    page.getByRole("navigation", { name: "أقسام ملف المورد" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: /المستحق للمورد: 24/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "فواتير الشراء" }),
  ).toContainText("E2E-WS-1");
  await expect(
    page.getByRole("region", { name: "أسماء الأصناف عند المورد" }),
  ).toContainText("يُحفظ الاسم هنا");
  await expect(
    page.getByRole("link", { name: "تسجيل دفعة للمورد" }),
  ).toBeVisible();
  await stickyClear(page);

  await page.goto("/admin/inventory/purchases?tab=unpaid");
  const row = page
    .getByRole("region", { name: "قائمة فواتير الشراء" })
    .getByRole("link", { name: new RegExp(SUPPLIER) });
  await expect(row).toContainText("غير مدفوعة");
  await page.getByRole("link", { name: "مدفوعة", exact: true }).click();
  await expect(
    page.getByRole("link", { name: new RegExp(SUPPLIER) }),
  ).toHaveCount(0);

  await page.goto("/admin/inventory");
  await expect(page.getByRole("region", { name: "صحة المخزون" })).toBeVisible();
  const anomalies = page.getByRole("region", { name: /أرقام تحتاج تدقيق/ });
  await expect(anomalies.getByRole("link", { name: /منظف عام/ })).toContainText(
    "سعر البيع أقل من متوسط التكلفة",
  );

  await page.goto("/admin/inventory/suppliers");
  // Other specs leave their own suppliers, so check this supplier rather than the store total.
  await expect(
    page.getByRole("region", { name: "مستحقات الموردين" }),
  ).toContainText("المستحق للموردين");
  const supplierRow = page
    .getByRole("list", { name: "قائمة الموردين" })
    .getByRole("listitem")
    .filter({ hasText: SUPPLIER });
  await expect(supplierRow.locator(".admin-balance-due")).toContainText("24");
  await expect(supplierRow).toContainText("مستحق له");
  expect(issues.consoleErrors).toEqual([]);
  expect(issues.failedRequests).toEqual([]);
});

test("stock sorting sits in a sheet on phones and inline on desktop", async ({
  page,
}) => {
  const issues = trackPageIssues(page);
  await login(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/admin/inventory/stock?filter=tracked");
  await page.getByRole("button", { name: "ترتيب", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "ترتيب المخزون" });
  await sheet.getByLabel("ترتيب").selectOption("available");
  await page.screenshot({ path: `${SHOTS}/stock-sort-390.png` });
  await sheet.getByRole("button", { name: "تطبيق الترتيب" }).click();
  await expect(page).toHaveURL(/sort=available/);
  // The filter tabs keep the chosen order.
  await expect(page.getByRole("link", { name: "الكل" })).toHaveAttribute(
    "href",
    /sort=available/,
  );

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/admin/inventory/stock?filter=tracked");
  await expect(
    page.getByRole("button", { name: "ترتيب", exact: true }),
  ).toBeHidden();
  await page.getByRole("combobox", { name: "ترتيب" }).selectOption("recent");
  await page.getByRole("button", { name: "تطبيق الترتيب" }).click();
  await expect(page).toHaveURL(/sort=recent/);
  await expect(
    page.getByRole("columnheader", { name: "حد الطلب" }),
  ).toBeVisible();
  expect(issues.consoleErrors).toEqual([]);
});

test("inventory pages fit 360 to 1440 and pass axe", async ({ page }) => {
  test.setTimeout(180_000);
  const issues = trackPageIssues(page);
  await login(page);
  const pages = [
    ["home", "/admin/inventory"],
    ["stock", "/admin/inventory/stock?filter=tracked"],
    ["purchases", "/admin/inventory/purchases"],
    ["purchase", invoicePath],
    ["suppliers", "/admin/inventory/suppliers"],
    ["supplier", supplierPath],
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
