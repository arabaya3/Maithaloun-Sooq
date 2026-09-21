import { mkdir } from "node:fs/promises";
import path from "node:path";

import { config as loadEnvironment } from "dotenv";
import { chromium } from "@playwright/test";

loadEnvironment({ path: ".env.local", quiet: true });

const outputDirectory = path.resolve("tmp-screenshots");
const origin = process.env.APP_ORIGIN ?? "http://localhost:3000";

await mkdir(outputDirectory, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({
  locale: "ar-PS",
  storageState: {
    cookies: [],
    origins: [],
  },
});
const page = await context.newPage();

async function openCheckout(width: number, height: number) {
  await page.setViewportSize({ width, height });
  await page.goto(origin, { waitUntil: "networkidle" });
  await page
    .getByRole("combobox", { name: "منطقة التوصيل" })
    .selectOption("maythalun");
  await page
    .locator('[data-product-id="general-cleaner"]')
    .getByRole("button", { name: /^أضف$/ })
    .click();
  await page.goto(`${origin}/checkout`, { waitUntil: "networkidle" });
}

try {
  await openCheckout(360, 800);
  await page.screenshot({
    path: path.join(outputDirectory, "checkout-mobile-360x800.png"),
    fullPage: true,
  });

  await page.getByRole("button", { name: "تأكيد الطلب" }).click();
  await page.locator(".checkout-error-summary").waitFor();
  await page.screenshot({
    path: path.join(outputDirectory, "checkout-validation-mobile-360x800.png"),
    fullPage: true,
  });

  await page.getByRole("textbox", { name: "الاسم الكامل" }).fill("عميل تجريبي");
  await page
    .getByRole("textbox", { name: "رقم الهاتف الفلسطيني" })
    .fill("0591234567");
  await page
    .getByRole("textbox", { name: "العنوان التفصيلي" })
    .fill("عنوان محلي مفصل للاختبار");
  await page.getByRole("button", { name: "تأكيد الطلب" }).click();
  await page.waitForURL(/\/orders\/MS-[A-Za-z0-9_-]{24}\/confirmation$/);
  await page.screenshot({
    path: path.join(outputDirectory, "confirmation-mobile-360x800.png"),
    fullPage: true,
  });

  await page.evaluate(() => window.localStorage.clear());
  await openCheckout(1440, 900);
  await page.screenshot({
    path: path.join(outputDirectory, "checkout-desktop-1440x900.png"),
    fullPage: true,
  });

  await page.getByRole("textbox", { name: "الاسم الكامل" }).fill("عميل تجريبي");
  await page
    .getByRole("textbox", { name: "رقم الهاتف الفلسطيني" })
    .fill("0591234567");
  await page
    .getByRole("textbox", { name: "العنوان التفصيلي" })
    .fill("عنوان محلي مفصل للاختبار");
  await page.getByRole("button", { name: "تأكيد الطلب" }).click();
  await page.waitForURL(/\/orders\/MS-[A-Za-z0-9_-]{24}\/confirmation$/);
  await page.screenshot({
    path: path.join(outputDirectory, "confirmation-desktop-1440x900.png"),
    fullPage: true,
  });
} finally {
  await browser.close();
}
