import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import {
  expectNoHorizontalOverflow,
  login,
  trackPageIssues,
  withTestDb,
} from "./support";

const SHOTS = "artifacts/whatsapp-checkout";
// A placeholder store number. WhatsApp itself is intercepted and never reached.
const STORE_NUMBER = "0590000000";

test.describe.configure({ mode: "serial" });

test.afterAll(async () => {
  await withTestDb(
    (sql) => sql`delete from store_settings where key = 'store_whatsapp_e164'`,
  );
});

/** Answers every WhatsApp address locally and records where the page tried to go. */
async function interceptWhatsApp(page: Page) {
  const visited: string[] = [];
  for (const pattern of ["https://wa.me/**", "https://web.whatsapp.com/**"]) {
    await page.context().route(pattern, (route) => {
      visited.push(route.request().url());
      return route.fulfill({
        contentType: "text/html",
        body: "<!doctype html><title>intercepted</title>",
      });
    });
  }
  return visited;
}

async function fillCart(page: Page) {
  await page.goto("/");
  await page
    .locator('[data-product-id="general-cleaner"]')
    .getByRole("button", { name: "أضف إلى السلة" })
    .click();
  await page.goto("/cart");
}

async function fillContact(page: Page) {
  await page
    .getByRole("textbox", { name: "الاسم", exact: true })
    .fill("عميل واتساب تجريبي");
  await page.getByRole("textbox", { name: "الرقم المحلي" }).fill("0591234567");
}

test("without a store number only the website channel is offered", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await fillCart(page);
  await expect(
    page.getByRole("link", { name: "الطلب عبر واتساب" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "الطلب عبر الموقع" }),
  ).toBeVisible();
  // Asking for WhatsApp directly falls back to the website form.
  await page.goto("/checkout?channel=whatsapp");
  await expect(
    page.getByRole("button", { name: "إرسال الطلب عبر الموقع" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "إرسال الطلب عبر واتساب" }),
  ).toHaveCount(0);
});

test("phone: the owner sets the number, a customer is handed to WhatsApp in the same tab", async ({
  page,
  context,
}) => {
  const issues = trackPageIssues(page);
  const visited = await interceptWhatsApp(page);
  const popups: string[] = [];
  context.on("page", (opened) => popups.push(opened.url()));
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await page.goto("/admin/settings#whatsapp");
  const section = page.getByRole("region", { name: "الطلب عبر واتساب" });
  await section.getByLabel("رقم واتساب المتجر").fill("12");
  await section.getByRole("button", { name: "حفظ الرقم" }).click();
  await expect(section.getByRole("alert")).toContainText("الرقم غير صالح");
  await section.getByLabel("رقم واتساب المتجر").fill(STORE_NUMBER);
  await section.getByRole("button", { name: "حفظ الرقم" }).click();
  await expect(section.getByRole("status")).toContainText(
    "حُفظ رقم واتساب المتجر",
  );

  await context.clearCookies();
  await fillCart(page);
  await expect(
    page.getByText("سنجهّز رسالة طلبك لتُرسل مباشرة إلى سوق ميثلون."),
  ).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/cart-390.png`, fullPage: true });
  await page.getByRole("link", { name: "الطلب عبر واتساب" }).click();
  await expect(page).toHaveURL(/\/checkout\?channel=whatsapp$/);
  await expect(page.getByLabel(/العنوان/)).toHaveCount(0);
  await fillContact(page);
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: `${SHOTS}/checkout-390.png`, fullPage: true });

  const handedOff = page.waitForRequest(/^https:\/\/wa\.me\//);
  await page.getByRole("button", { name: "إرسال الطلب عبر واتساب" }).click();
  await handedOff;
  await expect.poll(() => visited.length).toBe(1);
  expect(popups).toEqual([]);
  const app = visited[0]!;
  expect(app).toMatch(/^https:\/\/wa\.me\/970590000000\?text=/);
  const text = decodeURIComponent(app.split("text=")[1]!);
  expect(text.split("\n")[0]).toBe("مرحباً سوق ميثلون،");
  const reference = /MS-[A-Za-z0-9_-]{24}/.exec(text)![0];
  expect(text).toContain("الدفع نقداً عند الاستلام.");
  // The message never carries the customer's details or internal ids.
  expect(text).not.toMatch(/0591234567|عنوان|عميل واتساب|general-cleaner/);

  // Coming back shows the fallback links instead of opening WhatsApp again.
  await page.goto(`/orders/${reference}/confirmation`);
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "خطوة أخيرة: أرسل الطلب على واتساب",
    }),
  ).toBeVisible();
  const handoff = page.getByRole("region", {
    name: "أرسل الطلب على واتساب لتأكيده",
  });
  await expect(
    handoff.getByRole("link", { name: "فتح واتساب" }),
  ).toHaveAttribute("href", app);
  await expect(
    handoff.getByRole("link", { name: "واتساب ويب" }),
  ).toHaveAttribute(
    "href",
    /^https:\/\/web\.whatsapp\.com\/send\?phone=970590000000&text=/,
  );
  await expect(handoff.getByLabel("نص الرسالة")).toHaveValue(text);
  expect(visited).toHaveLength(1);
  await expectNoHorizontalOverflow(page);
  const axe = await new AxeBuilder({ page })
    .include("main")
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(axe.violations.map((violation) => violation.id)).toEqual([]);
  await page.screenshot({
    path: `${SHOTS}/confirmation-390.png`,
    fullPage: true,
  });

  const [order] = await withTestDb(
    (sql) => sql<
      { status: string; checkout_channel: string; address: string | null }[]
    >`
      select status, checkout_channel, address from orders
      where public_reference = ${reference}`,
  );
  expect(order).toEqual({
    status: "awaiting_whatsapp",
    checkout_channel: "whatsapp",
    address: null,
  });

  // The owner sees it waiting, with the place still to be agreed on WhatsApp.
  await login(page);
  await page.goto(`/admin/orders/${reference}`);
  await expect(page.getByText("بانتظار تأكيد واتساب").first()).toBeVisible();
  await expect(page.getByText("يُحدّد عبر واتساب")).toBeVisible();
  expect(issues.consoleErrors).toEqual([]);
});

test("web channel: the order arrives pending and the store will reach out on WhatsApp", async ({
  page,
}) => {
  const visited = await interceptWhatsApp(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await fillCart(page);
  await page.getByRole("link", { name: "الطلب عبر الموقع" }).click();
  await expect(page).toHaveURL(/\/checkout\?channel=web$/);
  await fillContact(page);
  await expect(
    page.getByText(
      "بعد استلام الطلب سنتواصل معك عبر واتساب لتأكيد الطلب ومكان التوصيل داخل ميثلون.",
    ),
  ).toBeVisible();
  await page.screenshot({
    path: `${SHOTS}/checkout-web-390.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "إرسال الطلب عبر الموقع" }).click();
  await expect(page).toHaveURL(/\/orders\/MS-[A-Za-z0-9_-]{24}\/confirmation$/);
  await expect(page.getByText(/سنتواصل معك عبر واتساب/)).toBeVisible();
  const reference = /orders\/(MS-[^/]+)\//.exec(page.url())![1]!;
  const [order] = await withTestDb(
    (sql) => sql<{ status: string; checkout_channel: string }[]>`
      select status, checkout_channel from orders
      where public_reference = ${reference}`,
  );
  expect(order).toEqual({ status: "pending", checkout_channel: "web" });
  expect(visited).toEqual([]);
});
