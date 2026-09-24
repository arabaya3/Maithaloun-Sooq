import { config as loadEnvironment } from "dotenv";
import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";

import { parseTestEnv } from "../../src/server/env/env-schema";

loadEnvironment({ path: ".env.local", quiet: true });
const environment = parseTestEnv({
  DATABASE_URL: process.env.DATABASE_URL,
  TEST_DATABASE_URL: process.env.TEST_DATABASE_URL,
  ORDER_RATE_LIMIT_PEPPER: process.env.ORDER_RATE_LIMIT_PEPPER,
  APP_ORIGIN: process.env.APP_ORIGIN,
});

async function countOrders(): Promise<number> {
  const client = postgres(environment.TEST_DATABASE_URL, {
    max: 1,
    prepare: false,
  });
  try {
    const rows = await client<{ count: number }[]>`
      select count(*)::int as count from orders
    `;
    const row = rows[0];
    if (!row) throw new Error("Order count query returned no rows");
    return row.count;
  } finally {
    await client.end();
  }
}

async function openCheckout(page: Page) {
  await page.goto("/");
  await expect(page.getByLabel("منطقة التوصيل")).toHaveText(
    "التوصيل داخل ميثلون",
  );
  const product = page.locator('[data-product-id="general-cleaner"]');
  await product.getByRole("button", { name: /^أضف$/ }).click();
  await page.locator(".cart-button").click();
  await page.getByRole("link", { name: "متابعة إلى بيانات الطلب" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "بيانات الطلب" }),
  ).toBeVisible();
}

async function fillCheckout(
  page: Page,
  options: {
    countryCode?: "970" | "972";
    nationalNumber?: string;
    name?: string;
    address?: string;
  } = {},
) {
  await page
    .getByRole("textbox", { name: "الاسم الكامل" })
    .fill(options.name ?? "عميل تجريبي");
  await page
    .getByLabel("مفتاح الدولة")
    .selectOption(options.countryCode ?? "970");
  await page
    .getByRole("textbox", { name: "الرقم المحلي" })
    .fill(options.nationalNumber ?? "0591234567");
  await page
    .getByRole("textbox", {
      name: "العنوان بالتفصيل أو أقرب نقطة دالة",
    })
    .fill(options.address ?? "عنوان محلي مفصل للاختبار");
}

test("validates and creates a cash-on-delivery order with +970", async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  const failedRequests: string[] = [];
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    if (message.text().includes("status of 400 (Bad Request)")) return;
    consoleErrors.push(message.text());
  });
  page.on("requestfailed", (request) => {
    if (request.failure()?.errorText === "net::ERR_ABORTED") return;
    failedRequests.push(`${request.method()} ${request.url()}`);
  });

  await openCheckout(page);
  await expect(page.getByText("7 ₪").first()).toBeVisible();
  await expect(page.getByText("5 ₪").first()).toBeVisible();
  await expect(
    page.getByText("التوصيل متاح حالياً داخل ميثلون فقط"),
  ).toBeVisible();
  await expect(
    page.getByText("يُستخدم رقم الواتساب فقط لتأكيد الطلب وتنفيذ التوصيل."),
  ).toBeVisible();

  await page.getByRole("button", { name: "تأكيد الطلب" }).click();
  await expect(page.locator(".checkout-error-summary")).toContainText(
    "يرجى مراجعة الحقول المطلوبة.",
  );
  await expect(page.getByText("أدخل الاسم الكامل.")).toBeVisible();
  await expect(
    page.getByText("أدخل العنوان بالتفصيل أو أقرب نقطة دالة."),
  ).toBeVisible();

  await fillCheckout(page, {
    countryCode: "970",
    nationalNumber: "0591234567",
  });
  await page.getByRole("button", { name: "تأكيد الطلب" }).click();
  await expect(page).toHaveURL(/\/orders\/MS-[A-Za-z0-9_-]{24}\/confirmation$/);
  expect(page.url()).not.toMatch(/059|970|عميل|عنوان/);
  await expect(
    page.getByRole("heading", { name: "شكراً، طلبك قيد المراجعة" }),
  ).toBeVisible();
  await expect(page.getByText("5 ₪")).toBeVisible();
  await expect(page.getByText("نقداً عند الاستلام")).toBeVisible();
  await expect(page.getByText("7 ₪")).toBeVisible();
  await expect(page.getByText("عميل تجريبي")).toHaveCount(0);
  await expect(page.getByText("0591234567")).toHaveCount(0);

  await page.getByRole("link", { name: "العودة إلى المتجر" }).click();
  await expect(page.locator(".cart-button")).toHaveAccessibleName(
    "السلة، لا منتجات",
  );
  expect(consoleErrors).toEqual([]);
  expect(failedRequests).toEqual([]);
});

test("creates a cash-on-delivery order with +972", async ({ page }) => {
  await openCheckout(page);
  await fillCheckout(page, {
    countryCode: "972",
    nationalNumber: "0521234567",
  });
  await page.getByRole("button", { name: "تأكيد الطلب" }).click();
  await expect(page).toHaveURL(/\/orders\/MS-[A-Za-z0-9_-]{24}\/confirmation$/);
  expect(page.url()).not.toMatch(/052|972|عميل|عنوان/);
});

test("failed submission preserves the cart", async ({ page }) => {
  await openCheckout(page);
  await fillCheckout(page);
  await page.route("/api/orders", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        ok: false,
        message: "تعذّر حفظ الطلب الآن. لم يتم إنشاء طلب جديد.",
      }),
    }),
  );

  await page.getByRole("button", { name: "تأكيد الطلب" }).click();
  await expect(page.locator(".checkout-error-summary")).toContainText(
    "تعذّر حفظ الطلب الآن.",
  );
  await expect(page.locator(".cart-button")).toHaveAccessibleName(
    "السلة، منتج واحد",
  );
  await expect(page.getByRole("textbox", { name: "الاسم الكامل" })).toHaveValue(
    "عميل تجريبي",
  );
});

test("duplicate clicks create one database order", async ({ page }) => {
  const before = await countOrders();
  await openCheckout(page);
  await fillCheckout(page);

  await page.getByRole("button", { name: "تأكيد الطلب" }).evaluate((button) => {
    if (button instanceof HTMLButtonElement) {
      button.click();
      button.click();
    }
  });
  await expect(page).toHaveURL(/\/orders\/MS-[A-Za-z0-9_-]{24}\/confirmation$/);
  expect(await countOrders()).toBe(before + 1);
});

for (const viewport of [
  { width: 360, height: 800 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1440, height: 900 },
]) {
  test(`checkout avoids overflow at ${viewport.width}x${viewport.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await openCheckout(page);
    await fillCheckout(page);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });
}
