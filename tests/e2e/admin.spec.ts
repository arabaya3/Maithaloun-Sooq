import { config as loadEnvironment } from "dotenv";
import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";

import {
  getPrimaryNextActionLabel,
  orderStatusLabels,
} from "../../src/features/orders/domain/order-status";
import { parseTestEnv } from "../../src/server/env/env-schema";
import { parseTestAdminEnv } from "../../src/test/test-admin";

loadEnvironment({ path: ".env.local", quiet: true });
const environment = parseTestEnv({
  DATABASE_URL: process.env.DATABASE_URL,
  TEST_DATABASE_URL: process.env.TEST_DATABASE_URL,
  ORDER_RATE_LIMIT_PEPPER: process.env.ORDER_RATE_LIMIT_PEPPER,
  APP_ORIGIN: process.env.APP_ORIGIN,
  TRUST_PROXY: process.env.TRUST_PROXY,
});
const admin = parseTestAdminEnv({
  TEST_ADMIN_USERNAME: process.env.TEST_ADMIN_USERNAME,
  TEST_ADMIN_PASSWORD: process.env.TEST_ADMIN_PASSWORD,
  TEST_ADMIN_DISPLAY_NAME: process.env.TEST_ADMIN_DISPLAY_NAME,
});

function trackPageIssues(page: Page) {
  const consoleErrors: string[] = [];
  const failedRequests: string[] = [];
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    consoleErrors.push(message.text());
  });
  page.on("requestfailed", (request) => {
    if (request.failure()?.errorText === "net::ERR_ABORTED") return;
    failedRequests.push(`${request.method()} ${request.url()}`);
  });
  return { consoleErrors, failedRequests };
}

async function withTestDb<T>(
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

async function restoreCatalog() {
  await withTestDb(async (sql) => {
    await sql`
      update products
      set price_agorot = 700, availability = 'available'
      where domain_id = 'general-cleaner'
    `;
    await sql`
      update service_areas
      set enabled = true, delivery_fee_agorot = null
      where code = 'maythalun'
    `;
  });
}

async function openAdminNav(page: Page) {
  const menu = page.getByRole("button", { name: "القائمة" });
  if (await menu.isVisible()) {
    await menu.click();
    await expect(
      page.getByRole("dialog", { name: "قائمة الإدارة" }),
    ).toBeVisible();
  }
}

async function goAdminSection(page: Page, name: string) {
  const menu = page.getByRole("button", { name: "القائمة" });
  if (await menu.isVisible()) {
    await openAdminNav(page);
    await page
      .getByRole("dialog", { name: "قائمة الإدارة" })
      .getByRole("link", { name, exact: true })
      .click();
  } else {
    await page.getByRole("link", { name, exact: true }).click();
  }
  const headings: Record<string, string | RegExp> = {
    "لوحة المتابعة": "لوحة المتابعة",
    الطلبات: "الطلبات",
    المنتجات: "المنتجات",
    "إعدادات المتجر": "إعدادات المتجر",
  };
  const heading = headings[name] ?? name;
  await expect(
    page.getByRole("heading", { name: heading, level: 1 }),
  ).toBeVisible({
    timeout: 15_000,
  });
}

async function login(page: Page) {
  await page.goto("/admin");
  if (page.url().includes("/admin/login")) {
    await page.getByLabel("اسم المستخدم").fill(admin.TEST_ADMIN_USERNAME);
    await page.getByLabel("كلمة المرور").fill(admin.TEST_ADMIN_PASSWORD);
    await page
      .getByRole("button", { name: "دخول الإدارة" })
      .click({ force: true });
  }
  await expect(
    page.getByRole("heading", { name: "لوحة المتابعة" }),
  ).toBeVisible({ timeout: 15_000 });
}

test.afterEach(async () => {
  await restoreCatalog();
});

test("admin authentication, operations, and privacy controls", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const issues = trackPageIssues(page);
  await page.setViewportSize({ width: 390, height: 844 });

  await page.goto("/admin/orders");
  await expect(page).toHaveURL(/\/admin\/login/);
  const loginResponse = await page.goto("/admin/login");
  const cacheControl = loginResponse?.headers()["cache-control"] ?? "";
  const robotsTag = loginResponse?.headers()["x-robots-tag"] ?? "";
  expect(
    /no-store/.test(cacheControl) ||
      (/no-cache/.test(cacheControl) && /noindex/.test(robotsTag)),
  ).toBe(true);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    "content",
    /noindex/,
  );
  await page.screenshot({
    path: "artifacts/admin-screenshots/admin-login-mobile.png",
    fullPage: true,
  });

  await page.getByLabel("اسم المستخدم").fill("unknown-owner");
  await page.getByLabel("كلمة المرور").fill("definitely-wrong-password");
  await page
    .getByRole("button", { name: "دخول الإدارة" })
    .click({ force: true });
  await expect(page.locator(".admin-form-error")).toHaveText(
    "تعذّر تسجيل الدخول. تحقق من البيانات وحاول مجدداً.",
  );

  await login(page);
  await expect(page.getByText("طلبات جديدة")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "طلبات تحتاج إجراء" }),
  ).toBeVisible();
  await page.screenshot({
    path: "artifacts/admin-screenshots/dashboard-mobile.png",
    fullPage: true,
  });
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "لوحة المتابعة" }),
  ).toBeVisible();

  await goAdminSection(page, "المنتجات");
  await page
    .getByRole("link", { name: /منظف عام/ })
    .first()
    .click();
  await page.screenshot({
    path: "artifacts/admin-screenshots/product-editor-mobile.png",
    fullPage: true,
  });
  await page.locator("#product-price").fill("8.50");
  await page.locator("#product-availability").selectOption("unavailable");
  await page.getByRole("button", { name: "حفظ المنتج" }).click();
  await expect(
    page.getByRole("heading", { name: "تعديل المنتج" }),
  ).toBeVisible();

  await page.goto("/products/general-cleaner-secret", {
    waitUntil: "networkidle",
  });
  await expect(page.getByText(/8\.5\s*₪/)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("غير متاح حالياً")).toBeVisible();

  await login(page);
  await goAdminSection(page, "المنتجات");
  await page
    .getByRole("link", { name: /منظف عام/ })
    .first()
    .click();
  await page.locator("#product-price").fill("7.00");
  await page.locator("#product-availability").selectOption("available");
  await page.getByRole("button", { name: "حفظ المنتج" }).click();
  await expect(
    page.getByRole("heading", { name: "تعديل المنتج" }),
  ).toBeVisible();

  await goAdminSection(page, "إعدادات المتجر");
  await page.screenshot({
    path: "artifacts/admin-screenshots/settings-mobile.png",
    fullPage: true,
  });
  const maythalunForm = page.locator("form", {
    has: page.locator("#fee-maythalun"),
  });
  await maythalunForm.getByLabel("الحالة").selectOption("true");
  await maythalunForm.getByLabel("مبلغ معروف").check();
  await maythalunForm.getByLabel("المبلغ بالشيكل").fill("3.00");
  await maythalunForm.getByRole("button", { name: "حفظ المنطقة" }).click();
  await expect(
    page.getByRole("heading", { name: "إعدادات المتجر" }),
  ).toBeVisible();

  await goAdminSection(page, "المنتجات");
  await page.getByRole("link", { name: "إضافة منتج" }).click();
  await expect(
    page.getByText("هذا المنتج له أكثر من حجم أو وزن"),
  ).toBeVisible();
  await page.screenshot({
    path: "artifacts/admin-screenshots/product-create-quick-mobile.png",
    fullPage: true,
  });
  const quickId = `e2e-quick-${Date.now().toString(36)}`;
  await page.locator("#product-name-ar").fill("منتج إضافة سريعة");
  await page
    .locator("summary")
    .filter({ hasText: "معرّف الرابط والاسم اللاتيني" })
    .click();
  await page.locator("#product-latin-name").fill(quickId);
  await page.locator("#product-price").fill("4.50");
  await page.getByRole("button", { name: "إنشاء المنتج" }).click();
  await expect(page.getByRole("heading", { name: "تعديل المنتج" })).toBeVisible(
    { timeout: 15_000 },
  );
  await expect(page.locator("#product-name-ar")).toHaveValue(
    "منتج إضافة سريعة",
  );

  await goAdminSection(page, "المنتجات");
  await page.getByRole("link", { name: "إضافة منتج" }).click();
  await page.getByRole("checkbox", { name: /أكثر من حجم أو وزن/ }).check();
  await expect(
    page.getByRole("heading", { name: "المعلومات الأساسية" }),
  ).toBeVisible();
  await page.screenshot({
    path: "artifacts/admin-screenshots/product-create-wizard-mobile.png",
    fullPage: true,
  });
  const wizardId = `e2e-wiz-${Date.now().toString(36)}`;
  await page.locator("#wiz-name-ar").fill("منتج متعدد الأحجام");
  await page.locator("#wiz-price").fill("9.00");
  await page.locator("#wiz-latin").fill(wizardId);
  await page.getByRole("button", { name: "التالي" }).click();
  await expect(
    page.getByRole("heading", { name: "الأحجام والأوزان" }),
  ).toBeVisible();
  await page.locator("#wiz-unit").fill("١.٢٥ كغم");
  await page.getByRole("button", { name: "التالي" }).click();
  await expect(
    page.getByRole("heading", { name: "صورة المنتج" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "التالي" }).click();
  await expect(page.getByRole("heading", { name: "المراجعة" })).toBeVisible();
  await page.getByRole("button", { name: "إنشاء المنتج" }).click();
  await expect(page.getByRole("heading", { name: "تعديل المنتج" })).toBeVisible(
    { timeout: 15_000 },
  );

  await page.goto("/");
  await expect(page.getByLabel("منطقة التوصيل")).toHaveText(
    "التوصيل داخل ميثلون",
  );
  const product = page.locator('[data-product-id="dolphin-bleach"]');
  await expect(product).toBeVisible();
  await product.getByRole("button", { name: /^أضف$/ }).click();
  await expect(page.locator(".cart-button")).toHaveAccessibleName(
    /السلة، منتج/,
  );
  await page.locator(".cart-button").click();
  await page.getByRole("link", { name: "متابعة إلى بيانات الطلب" }).click();
  await expect(page).toHaveURL(/\/checkout/);
  await expect(page.getByRole("heading", { name: "بيانات الطلب" })).toBeVisible(
    {
      timeout: 15_000,
    },
  );
  await expect(page.locator(".checkout-delivery")).toContainText("5 ₪");
  await expect(page.getByText("مبيض Dolphin")).toBeVisible();
  await page.getByRole("textbox", { name: "الاسم الكامل" }).fill("عميل تجريبي");
  await page.getByLabel("مفتاح الدولة").selectOption("970");
  await page.getByRole("textbox", { name: "الرقم المحلي" }).fill("0591234567");
  await page
    .getByRole("textbox", {
      name: "العنوان بالتفصيل أو أقرب نقطة دالة",
    })
    .fill("عنوان محلي مفصل للاختبار");
  await page.getByRole("button", { name: "تأكيد الطلب" }).click();
  await expect(
    page.getByRole("heading", { name: /طلبك قيد المراجعة/ }),
  ).toBeVisible({ timeout: 15_000 });
  const reference = (
    await page.locator(".order-reference strong").innerText()
  ).trim();

  const stored = await withTestDb(
    (sql) => sql<
      {
        delivery_fee_agorot: number | null;
        final_total_agorot: number | null;
        whatsapp_phone_e164: string | null;
      }[]
    >`
      select delivery_fee_agorot, final_total_agorot, whatsapp_phone_e164
      from orders
      where public_reference = ${reference}
    `,
  );
  expect(stored[0]?.delivery_fee_agorot).toBe(500);
  expect(stored[0]?.final_total_agorot).toBe(1300);
  expect(stored[0]?.whatsapp_phone_e164).toBe("+970591234567");

  await login(page);
  await goAdminSection(page, "الطلبات");
  await page.screenshot({
    path: "artifacts/admin-screenshots/orders-mobile.png",
    fullPage: true,
  });
  await page
    .locator(
      `.admin-order-cards .admin-order-card-top a[href="/admin/orders/${reference}"]`,
    )
    .click();
  await expect(
    page.getByRole("heading", { name: new RegExp(reference) }),
  ).toBeVisible({ timeout: 15_000 });
  await page.screenshot({
    path: "artifacts/admin-screenshots/order-details-mobile.png",
    fullPage: true,
  });
  await expect(page.getByText("الاسم الكامل")).toBeVisible();
  await expect(page.getByText("عميل تجريبي")).toBeVisible();
  const whatsappLink = page.getByRole("link", { name: "تواصل عبر واتساب" });
  await expect(whatsappLink).toBeVisible();
  await expect(whatsappLink).toHaveAttribute(
    "href",
    new RegExp(`^https://wa\\.me/970591234567\\?text=.*${reference}`),
  );
  await expect(whatsappLink).toHaveAttribute("rel", "noopener noreferrer");
  await expect(whatsappLink).toHaveAttribute("target", "_blank");
  await expect(page.getByRole("button", { name: "تم التسليم" })).toHaveCount(0);
  await page
    .getByRole("button", { name: getPrimaryNextActionLabel("pending")! })
    .click();
  await expect(
    page.getByText(orderStatusLabels.confirmed).first(),
  ).toBeVisible();
  await page
    .getByRole("button", { name: getPrimaryNextActionLabel("confirmed")! })
    .click();
  await page
    .getByRole("button", {
      name: getPrimaryNextActionLabel("preparing")!,
    })
    .click();
  await page
    .getByRole("button", {
      name: getPrimaryNextActionLabel("out_for_delivery")!,
    })
    .click();
  await expect(
    page.getByText("هذه الحالة نهائية ولا يمكن تغييرها."),
  ).toBeVisible();

  await openAdminNav(page);
  await page
    .getByRole("dialog", { name: "قائمة الإدارة" })
    .getByRole("button", { name: "تسجيل الخروج" })
    .click({ force: true });
  await expect(
    page.getByRole("heading", { name: "دخول إدارة سوق ميثلون" }),
  ).toBeVisible();
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/admin\/login/);

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
  await page.keyboard.press("Tab");
  const controller = await page.evaluate(
    () => navigator.serviceWorker.controller?.scriptURL ?? null,
  );
  expect(controller).toBeNull();
  expect(issues.consoleErrors).toEqual([]);
  expect(issues.failedRequests).toEqual([]);
});

test("admin desktop layout and screenshots", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page);
  await expect(
    page.getByRole("heading", { name: "لوحة المتابعة" }),
  ).toBeVisible();
  await page.screenshot({
    path: "artifacts/admin-screenshots/dashboard-desktop.png",
    fullPage: true,
  });
  await page
    .locator(".admin-sidebar")
    .getByRole("link", { name: "الطلبات", exact: true })
    .click();
  await expect(page.getByRole("heading", { name: "الطلبات" })).toBeVisible();
  await page.screenshot({
    path: "artifacts/admin-screenshots/orders-desktop.png",
    fullPage: true,
  });
  const firstOrder = page.locator(".admin-table-desktop tbody a").first();
  if ((await firstOrder.count()) > 0) {
    await firstOrder.click();
    await expect(page.getByText("الاسم الكامل")).toBeVisible();
    await page.screenshot({
      path: "artifacts/admin-screenshots/order-details-desktop.png",
      fullPage: true,
    });
  }
  await page
    .locator(".admin-sidebar")
    .getByRole("link", { name: "المنتجات", exact: true })
    .click();
  await expect(page.getByRole("heading", { name: "المنتجات" })).toBeVisible();
  await page
    .locator(".admin-table-desktop a")
    .filter({ hasText: /منظف عام/ })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { name: "تعديل المنتج" }),
  ).toBeVisible();
  await page.screenshot({
    path: "artifacts/admin-screenshots/product-editor-desktop.png",
    fullPage: true,
  });
  await page
    .locator(".admin-sidebar")
    .getByRole("link", { name: "إعدادات المتجر", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "إعدادات المتجر" }),
  ).toBeVisible();
  await page.screenshot({
    path: "artifacts/admin-screenshots/settings-desktop.png",
    fullPage: true,
  });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
});
