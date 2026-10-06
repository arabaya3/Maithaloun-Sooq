import { expect, test, type Page } from "@playwright/test";

import {
  expectNoHorizontalOverflow,
  login,
  loginAs,
  trackPageIssues,
  withTestDb,
} from "./support";

const OPERATOR = {
  username: "e2e-operator",
  password: "Operator-e2e-pass-2026",
};
const PRODUCT = "فرشاة سجاد";
const SHOTS = "artifacts/store-ops";

test.describe.configure({ mode: "serial" });

async function bottomNav(page: Page) {
  return page.getByRole("navigation", { name: "التنقل السفلي" });
}

async function fillPurchase(page: Page, quantity: string, cost: string) {
  await page.getByRole("combobox", { name: "المورد" }).selectOption({
    label: "+ مورد جديد",
  });
  await page.getByLabel("اسم المورد الجديد").fill("مورد الفراشي");
  await page.getByLabel("رقم الفاتورة (اختياري)").fill("E2E-1001");
  await page.getByRole("button", { name: /منتج السطر 1/ }).click();
  const picker = page.getByRole("dialog", { name: "منتج السطر 1" });
  await picker.getByRole("searchbox", { name: "بحث عن منتج" }).fill("فرشاه");
  await picker.getByRole("button", { name: new RegExp(PRODUCT) }).click();
  await page.getByLabel(/^الكمية/).fill(quantity);
  await page.getByLabel(/سعر الشراء/).fill(cost);
}

test("owner records a manual purchase and sees stock on the phone", async ({
  page,
}) => {
  const issues = trackPageIssues(page);
  await login(page);

  const nav = await bottomNav(page);
  // Five areas: اليوم is a link; the others open a sheet of their pages.
  await expect(nav.getByRole("link")).toHaveText(["اليوم"]);
  await expect(nav.getByRole("button")).toHaveText([
    "البيع",
    "المخزون",
    "الكتالوج",
    "المزيد",
  ]);
  await page.screenshot({
    path: `${SHOTS}/admin-home-390.png`,
    fullPage: true,
  });

  const addButton = page
    .locator(".admin-mobile-header")
    .getByRole("button", { name: "إضافة" });
  await addButton.click();
  const addSheet = page.getByRole("dialog", { name: "ماذا تريدين أن تضيفي؟" });
  await expect(
    addSheet.getByRole("link", { name: /تصوير منتج/ }),
  ).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/add-task-sheet-390.png` });
  await page.keyboard.press("Escape");
  await expect(addSheet).toBeHidden();
  await expect(addButton).toBeFocused();

  await nav.getByRole("button", { name: "المخزون" }).click();
  await page
    .getByRole("dialog", { name: "المخزون" })
    .getByRole("link", { name: "المخزون", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "المخزون والمشتريات", level: 1 }),
  ).toBeVisible();
  await expect(page.getByText("لم يبدأ تتبّع المخزون بعد")).toBeVisible();

  await page
    .getByRole("navigation", { name: "إجراءات المخزون" })
    .getByRole("link", { name: "إدخال شراء يدوي" })
    .click();
  await expect(
    page.getByRole("heading", { name: "إدخال شراء يدوي", level: 1 }),
  ).toBeVisible();

  // Inline validation keeps the operator on the form with a persistent message.
  await page.getByRole("button", { name: "مراجعة الفاتورة" }).click();
  await expect(page.getByText("اختاري المورد.")).toBeVisible();
  await expect(
    page.getByText("راجعي الحقول المحدّدة ثم حاولي مجدداً."),
  ).toBeVisible();

  await fillPurchase(page, "10", "3.20");
  await expectNoHorizontalOverflow(page);
  await page.screenshot({
    path: `${SHOTS}/purchase-entry-390.png`,
    fullPage: true,
  });

  await page.getByRole("button", { name: "مراجعة الفاتورة" }).click();
  await expect(
    page.getByRole("heading", { name: "راجعي قبل الحفظ" }),
  ).toBeVisible();
  await expect(page.getByText("(يبدأ تتبّع هذا الصنف)")).toBeVisible();
  await expect(page.getByText("إجمالي الفاتورة")).toBeVisible();

  // Nothing is written before the explicit confirmation.
  const before = await withTestDb(
    (sql) => sql<{ total: number }[]>`
      select count(*)::int as total from purchase_invoices
      where reference = 'E2E-1001'
    `,
  );
  expect(before[0]?.total).toBe(0);
  await page.screenshot({
    path: `${SHOTS}/purchase-review-390.png`,
    fullPage: true,
  });

  await page.getByRole("button", { name: "تأكيد وحفظ في المخزون" }).click();
  await expect(
    page.getByRole("heading", { name: "تم حفظ فاتورة الشراء" }),
  ).toBeVisible({ timeout: 15_000 });

  const stored = await withTestDb(
    (sql) => sql<{ on_hand_milli: number; stock_value_agorot: number }[]>`
      select i.on_hand_milli, i.stock_value_agorot
      from inventory_items i
      join product_variants v on v.id = i.variant_id
      where v.domain_id = 'carpet-brush--default'
    `,
  );
  expect(stored[0]).toEqual({
    on_hand_milli: 10_000,
    stock_value_agorot: 3_200,
  });

  await page.getByRole("link", { name: "العودة إلى المخزون" }).click();
  await expect(page.getByText("وصل حديثاً")).toBeVisible();
  await page.screenshot({
    path: `${SHOTS}/inventory-overview-390.png`,
    fullPage: true,
  });

  await page.goto("/admin/inventory/stock?filter=tracked");
  const row = page
    .getByRole("list", { name: "أصناف المخزون" })
    .getByRole("link", { name: new RegExp(PRODUCT) });
  await expect(row).toContainText("المتوفر");
  await expect(row).toContainText("10");
  await expect(row).toContainText("التكلفة");
  await expectNoHorizontalOverflow(page);
  await page.screenshot({
    path: `${SHOTS}/inventory-list-390.png`,
    fullPage: true,
  });

  await page.setViewportSize({ width: 360, height: 800 });
  await expectNoHorizontalOverflow(page);
  await page.setViewportSize({ width: 390, height: 844 });

  // Keyboard: the row is a link and opens with Enter.
  await row.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: PRODUCT, level: 1 }),
  ).toBeVisible();

  await page
    .getByRole("combobox", { name: "نوع التعديل" })
    .selectOption("damaged");
  await page.getByLabel("الكمية التالفة").fill("1");
  await page.getByRole("button", { name: "حفظ التعديل" }).click();
  await expect(page.getByText("تم حفظ تعديل المخزون.")).toBeVisible();
  await expect(
    page.getByRole("list").filter({ hasText: "تالف" }).first(),
  ).toBeVisible();

  await page.getByLabel("نبّهيني عندما يصل المتوفر إلى").fill("9");
  await page.getByRole("button", { name: "حفظ الحد" }).click();
  await expect(page.getByText("تم حفظ حد التنبيه.")).toBeVisible();
  await page.goto("/admin/inventory/stock?filter=attention");
  await expect(
    page
      .getByRole("list", { name: "أصناف المخزون" })
      .getByRole("link", { name: new RegExp(PRODUCT) }),
  ).toContainText("قارب على النفاد");

  expect(issues.consoleErrors).toEqual([]);
  expect(issues.failedRequests).toEqual([]);
});

test("a repeated invoice reference is blocked at review", async ({ page }) => {
  await login(page);
  await page.goto("/admin/inventory/purchases/new");
  await page.getByRole("combobox", { name: "المورد" }).selectOption({
    label: "مورد الفراشي",
  });
  await page.getByLabel("رقم الفاتورة (اختياري)").fill("e2e 1001");
  await page.getByRole("button", { name: /منتج السطر 1/ }).click();
  await page
    .getByRole("dialog", { name: "منتج السطر 1" })
    .getByRole("button", { name: new RegExp(PRODUCT) })
    .click();
  await page.getByLabel(/^الكمية/).fill("2");
  await page.getByLabel(/سعر الشراء/).fill("3");
  await page.getByRole("button", { name: "مراجعة الفاتورة" }).click();
  await expect(
    page.getByText(/هذه الفاتورة مسجّلة مسبقاً لنفس المورد/),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "تأكيد وحفظ في المخزون" }),
  ).toBeDisabled();
});

test("desktop uses a data table for stock", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page);
  await page
    .locator(".admin-sidebar")
    .getByRole("link", { name: "المخزون", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "المخزون والمشتريات", level: 1 }),
  ).toBeVisible();
  await page.screenshot({
    path: `${SHOTS}/inventory-overview-1440.png`,
    fullPage: true,
  });
  await page.goto("/admin/inventory/stock");
  await expect(
    page.getByRole("columnheader", { name: "متوسط التكلفة" }),
  ).toBeVisible();
  await expect(page.getByRole("list", { name: "أصناف المخزون" })).toBeHidden();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({
    path: `${SHOTS}/inventory-list-1440.png`,
    fullPage: true,
  });
  for (const viewport of [
    { width: 768, height: 1024 },
    { width: 1024, height: 768 },
  ]) {
    await page.setViewportSize(viewport);
    await expectNoHorizontalOverflow(page);
  }
});

test("operator works with quantities but never sees costs or adjustments", async ({
  page,
  browser,
}) => {
  await login(page);
  await page.goto("/admin/settings");
  await page.getByLabel("اسم المستخدم").fill(OPERATOR.username);
  await page.getByLabel("اسم الموظفة").fill("موظفة الاختبار");
  await page.getByLabel("كلمة مرور جديدة").fill(OPERATOR.password);
  await page.getByRole("button", { name: "حفظ حساب الموظفة" }).click();
  await expect(page.getByText(/تم حفظ حساب الموظفة/)).toBeVisible();

  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const operatorPage = await context.newPage();
  await loginAs(operatorPage, OPERATOR);

  await operatorPage.goto("/admin/inventory");
  await expect(operatorPage.getByText("قيمة المخزون")).toHaveCount(0);
  await expect(
    operatorPage.getByRole("link", { name: "تعديل مخزون" }),
  ).toHaveCount(0);
  await expect(
    operatorPage.getByRole("link", { name: "إدخال شراء يدوي" }).first(),
  ).toBeVisible();

  await operatorPage.goto("/admin/inventory/stock?filter=tracked");
  const row = operatorPage
    .getByRole("list", { name: "أصناف المخزون" })
    .getByRole("link", { name: new RegExp(PRODUCT) });
  await expect(row).toContainText("المتوفر");
  await expect(row).not.toContainText("التكلفة");

  await row.click();
  await expect(
    operatorPage.getByRole("heading", { name: PRODUCT, level: 1 }),
  ).toBeVisible();
  await expect(operatorPage.getByText("متوسط التكلفة")).toHaveCount(0);
  await expect(
    operatorPage.getByRole("button", { name: "حفظ التعديل" }),
  ).toHaveCount(0);

  await operatorPage.goto("/admin/settings");
  await expect(operatorPage).toHaveURL(/\/admin$/);
  await (
    await bottomNav(operatorPage)
  )
    .getByRole("button", { name: "المزيد" })
    .click();
  await expect(
    operatorPage
      .getByRole("dialog", { name: "المزيد" })
      .getByRole("link", { name: "إعدادات المتجر" }),
  ).toHaveCount(0);
  await context.close();
});
