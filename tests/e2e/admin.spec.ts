import { config as loadEnvironment } from "dotenv";
import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";

import { orderStatusLabels } from "../../src/features/orders/domain/order-status";
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

async function login(page: Page) {
  await page.goto("/admin");
  if (page.url().includes("/admin/login")) {
    await page.getByLabel("اسم المستخدم").fill(admin.TEST_ADMIN_USERNAME);
    await page.getByLabel("كلمة المرور").fill(admin.TEST_ADMIN_PASSWORD);
    await page.getByRole("button", { name: "دخول الإدارة" }).click();
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
  test.setTimeout(90_000);
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
  await page.getByRole("button", { name: "دخول الإدارة" }).click();
  await expect(page.locator(".admin-form-error")).toHaveText(
    "تعذّر تسجيل الدخول. تحقق من البيانات وحاول مجدداً.",
  );

  await login(page);
  await expect(page.getByText("قيد الانتظار")).toBeVisible();
  await page.screenshot({
    path: "artifacts/admin-screenshots/dashboard-mobile.png",
    fullPage: true,
  });
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "لوحة المتابعة" }),
  ).toBeVisible();

  await page.getByRole("link", { name: "المنتجات" }).click();
  await page.getByRole("link", { name: /منظف عام/ }).click();
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
  await page.getByRole("link", { name: "المنتجات" }).click();
  await page.getByRole("link", { name: /منظف عام/ }).click();
  await page.locator("#product-price").fill("7.00");
  await page.locator("#product-availability").selectOption("available");
  await page.getByRole("button", { name: "حفظ المنتج" }).click();
  await expect(
    page.getByRole("heading", { name: "تعديل المنتج" }),
  ).toBeVisible();

  await page.getByRole("link", { name: "مناطق التوصيل" }).click();
  const maythalunForm = page.locator("form", {
    has: page.locator("#fee-maythalun"),
  });
  await maythalunForm.getByLabel("الحالة").selectOption("true");
  await maythalunForm.getByLabel("مبلغ معروف").check();
  await maythalunForm.getByLabel("المبلغ بالشيكل").fill("3.00");
  await maythalunForm.getByRole("button", { name: "حفظ المنطقة" }).click();
  await expect(
    page.getByRole("heading", { name: "مناطق التوصيل" }),
  ).toBeVisible();

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
  await page.getByRole("link", { name: "الطلبات" }).click();
  await page.screenshot({
    path: "artifacts/admin-screenshots/orders-mobile.png",
    fullPage: true,
  });
  await page.getByRole("link", { name: reference }).click();
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
  await page.getByRole("button", { name: orderStatusLabels.confirmed }).click();
  await expect(
    page.getByText(orderStatusLabels.confirmed).first(),
  ).toBeVisible();
  await page.getByRole("button", { name: orderStatusLabels.preparing }).click();
  await page
    .getByRole("button", { name: orderStatusLabels.out_for_delivery })
    .click();
  await page.getByRole("button", { name: orderStatusLabels.delivered }).click();
  await expect(
    page.getByText("هذه الحالة نهائية ولا يمكن تغييرها."),
  ).toBeVisible();

  await page.getByRole("button", { name: "تسجيل الخروج" }).click();
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
  await page.setViewportSize({ width: 1280, height: 800 });
  await login(page);
  await page.screenshot({
    path: "artifacts/admin-screenshots/dashboard-desktop.png",
    fullPage: true,
  });
  await page.getByRole("link", { name: "الطلبات" }).click();
  await page.screenshot({
    path: "artifacts/admin-screenshots/orders-desktop.png",
    fullPage: true,
  });
  const firstOrder = page.locator("table a").first();
  if (await firstOrder.count()) {
    await firstOrder.click();
    await page.screenshot({
      path: "artifacts/admin-screenshots/order-details-desktop.png",
      fullPage: true,
    });
  }
  await page.getByRole("link", { name: "المنتجات" }).click();
  await page.getByRole("link", { name: /منظف عام/ }).click();
  await page.screenshot({
    path: "artifacts/admin-screenshots/product-editor-desktop.png",
    fullPage: true,
  });
  await page.getByRole("link", { name: "مناطق التوصيل" }).click();
  await page.screenshot({
    path: "artifacts/admin-screenshots/delivery-area-editor-desktop.png",
    fullPage: true,
  });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
});
