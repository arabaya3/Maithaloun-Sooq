import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { expectNoHorizontalOverflow, login, trackPageIssues } from "./support";

const SHOTS = "artifacts/admin-sell";
const ORDER_CUSTOMER = "زبونة أثر الحالة";
const DEBTOR = "زبون كشف الحساب";
const WIDTHS = [
  [360, 800],
  [390, 844],
  [768, 1024],
  [1440, 900],
] as const;

test.describe.configure({ mode: "serial" });

let reference = "";

async function axe(page: Page, selector: string) {
  const result = await new AxeBuilder({ page })
    .include(selector)
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(
    result.violations.map((violation) => ({
      id: violation.id,
      nodes: violation.nodes.map((node) => node.target.join(" ")),
    })),
  ).toEqual([]);
}

async function stickyClearOfLauncher(page: Page) {
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

test("order page says what each status change does before it happens", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const issues = trackPageIssues(page);
  await page.goto("/");
  const product = page.locator('[data-product-id="general-cleaner"]');
  await expect(async () => {
    await product.getByRole("button", { name: "أضف إلى السلة" }).click();
    await expect(page.locator(".cart-button")).toHaveAccessibleName(
      /عدد المنتجات [1-9]/,
      { timeout: 2_000 },
    );
  }).toPass();
  await page.goto("/checkout");
  await page.getByLabel("الاسم الكامل").fill(ORDER_CUSTOMER);
  await page.getByLabel("الرقم المحلي").fill("0599333444");
  await page
    .getByLabel("العنوان بالتفصيل أو أقرب نقطة دالة")
    .fill("ميثلون الحي الغربي قرب المدرسة");
  await page.getByRole("button", { name: /تأكيد الطلب|إرسال الطلب/ }).click();
  await expect(page).toHaveURL(/\/orders\/.+\/confirmation/);
  reference = /\/orders\/([^/]+)\/confirmation/.exec(page.url())![1]!;
  await login(page);

  for (const [width, height] of WIDTHS) {
    await page.setViewportSize({ width, height });
    await page.goto(`/admin/orders/${reference}`);
    const actions = page.getByRole("region", { name: "الإجراءات المتاحة" });
    const confirm = actions.getByRole("button", { name: "تأكيد الطلب" });
    await expect(confirm).toBeEnabled();
    // The effect is announced with the button, not discovered afterwards.
    await expect(confirm).toHaveAccessibleDescription(
      /ماذا سيحدث عند التأكيد:.*«منظف عام.*» غير متتبَّع في المخزون، فلا يتغير\. لا يُحصَّل أي مبلغ الآن/,
    );
    const next = page.getByRole("link", {
      name: "الإجراء التالي: تأكيد الطلب",
    });
    if (width < 1024) {
      await expect(next).toBeVisible();
      await stickyClearOfLauncher(page);
    } else {
      await expect(next).toBeHidden();
    }
    await expectNoHorizontalOverflow(page);
    await axe(page, ".admin-status-form");
    await page.screenshot({ path: `${SHOTS}/order-${width}.png` });
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("link", { name: "الإجراء التالي: تأكيد الطلب" }).click();
  await expect(page).toHaveURL(/#status-actions$/);
  await page.getByRole("button", { name: "إلغاء الطلب" }).click();
  await expect(
    page.getByText("لا يوجد حجز لهذا الطلب، فلا يتغير المخزون."),
  ).toBeVisible();
  await page.getByRole("button", { name: "تراجع" }).click();
  await page.getByRole("button", { name: "تأكيد الطلب" }).click();
  await expect(page.getByRole("button", { name: "بدء التجهيز" })).toBeVisible();
  await page.getByRole("button", { name: "إلغاء الطلب" }).click();
  await expect(
    page.getByText("لا يوجد مبلغ مدفوع لإرجاعه؛ الطلب بالدفع عند التسليم."),
  ).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/order-cancel-390.png` });
  expect(issues.consoleErrors).toEqual([]);
  expect(issues.failedRequests).toEqual([]);
});

test("order filters sit in a sheet on phones and inline on desktop", async ({
  page,
}) => {
  const issues = trackPageIssues(page);
  await login(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/admin/orders");
  const toggle = page.getByRole("button", { name: /^تصفية/ });
  await expect(toggle).toBeVisible();
  await toggle.click();
  const sheet = page.getByRole("dialog", { name: "تصفية الطلبات" });
  await expect(sheet).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: `${SHOTS}/orders-filter-390.png` });
  await sheet.getByRole("button", { name: "عرض النتائج" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/admin/orders");
  await expect(page.getByRole("button", { name: /^تصفية/ })).toBeHidden();
  // The same fields render inline in the toolbar, applied by its own button.
  await expect(page.getByLabel("من")).toBeVisible();
  await expect(page.getByLabel("ترتيب")).toBeVisible();
  await expect(page.getByRole("button", { name: "عرض النتائج" })).toBeHidden();
  await page.getByLabel("ترتيب").selectOption("oldest");
  await page.getByRole("button", { name: "تطبيق" }).click();
  await expect(page).toHaveURL(/sort=oldest/);
  await page.screenshot({ path: `${SHOTS}/orders-1440.png` });
  expect(issues.consoleErrors).toEqual([]);
});

test("credit sale: day totals, payment chip, statement, aging and payment preview", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const issues = trackPageIssues(page);
  await login(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/admin/sales/new");
  await page.getByRole("button", { name: /منتج السطر 1/ }).click();
  const picker = page.getByRole("dialog", { name: "منتج السطر 1" });
  await picker.getByRole("searchbox", { name: "بحث عن منتج" }).fill("منظف");
  await picker.getByRole("button").filter({ hasText: "منظف" }).first().click();
  await page.getByLabel("سعر البيع ₪").fill("25");
  await page.getByRole("radio", { name: "زبون جديد" }).check();
  await page.getByLabel("اسم الزبون").fill(DEBTOR);
  await page.getByRole("radio", { name: "على الحساب" }).check();
  await page.getByRole("button", { name: "مراجعة البيع" }).click();
  await page.getByRole("button", { name: "تأكيد وحفظ البيع" }).click();
  await expect(
    page.getByRole("heading", { name: "تم حفظ البيع" }),
  ).toBeVisible();

  await page.getByRole("link", { name: "عرض الفاتورة ومشاركتها" }).click();
  const toAccount = page.getByRole("link", {
    name: "حساب الزبون وتسجيل دفعة",
  });
  await expect(toAccount).toBeVisible();
  await stickyClearOfLauncher(page);
  await toAccount.click();
  await expect(page).toHaveURL(/\/admin\/customers\/.+#payment$/);

  for (const [width, height] of WIDTHS) {
    await page.setViewportSize({ width, height });
    await page.reload();
    const statement = page.getByRole("region", { name: "كشف الحساب" });
    await expect(statement).toContainText("فاتورة بيع");
    await expect(statement).toContainText("25 ₪");
    await expect(
      page.getByRole("navigation", { name: "أقسام ملف الزبون" }),
    ).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await axe(page, "main");
    await page.screenshot({
      path: `${SHOTS}/customer-${width}-full.png`,
      fullPage: true,
    });
  }

  const payment = page.getByRole("region", { name: "تسجيل دفعة" });
  await payment.getByLabel("المبلغ المستلم ₪").fill("10");
  await expect(payment).toContainText("الرصيد بعد الدفعة15 ₪");
  await payment.getByLabel("المبلغ المستلم ₪").fill("40");
  await expect(payment).toContainText("المبلغ أكبر من الرصيد المستحق بـ 15 ₪.");
  await payment.getByRole("button", { name: "تسجيل دفعة" }).click();
  await expect(
    page.getByText("المبلغ أكبر من رصيد الزبون المستحق."),
  ).toBeVisible();
  await payment.getByLabel("المبلغ المستلم ₪").fill("10");
  await payment.getByRole("button", { name: "تسجيل دفعة" }).click();
  await expect(
    page.getByRole("region", { name: "الحساب", exact: true }),
  ).toContainText("15 ₪");
  await expect(payment.getByLabel("المبلغ المستلم ₪")).toHaveValue("");
  const statement = page.getByRole("region", { name: "كشف الحساب" });
  await expect(statement).toContainText("دفعة");

  await page.goto("/admin/customers?filter=owing");
  await expect(page.getByRole("region", { name: "عمر الديون" })).toBeVisible();
  await expect(
    page.getByRole("link", { name: new RegExp(DEBTOR) }),
  ).toContainText("أقدم دين منذ 0 يوم");
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: `${SHOTS}/customers-390.png` });

  await page.goto("/admin/sales");
  const today = page.getByRole("region", { name: "مبيعات اليوم" });
  await expect(today).toContainText("على الحساب");
  await expect(
    page.getByRole("region", { name: "قائمة فواتير البيع" }),
  ).toContainText("على الحساب");
  await expectNoHorizontalOverflow(page);
  await axe(page, "main");
  await page.screenshot({ path: `${SHOTS}/sales-390.png` });
  expect(issues.consoleErrors).toEqual([]);
  expect(issues.failedRequests).toEqual([]);
});
