import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import {
  expectNoHorizontalOverflow,
  login,
  trackPageIssues,
  withTestDb,
} from "./support";

const SHOTS = "artifacts/whatsapp-checkout";
// A placeholder store number; tests read the generated links and never open them.
const STORE_NUMBER = "0590000000";

test.describe.configure({ mode: "serial" });

test.afterAll(async () => {
  await withTestDb(
    (sql) => sql`delete from store_settings where key = 'store_whatsapp_e164'`,
  );
});

async function openCheckout(page: Page) {
  await page.goto("/");
  await page
    .locator('[data-product-id="general-cleaner"]')
    .getByRole("button", { name: "أضف إلى السلة" })
    .click();
  await page.goto("/checkout");
  await page
    .getByRole("textbox", { name: "الاسم الكامل" })
    .fill("عميل واتساب تجريبي");
  await page.getByRole("textbox", { name: "الرقم المحلي" }).fill("0591234567");
  await page
    .getByRole("textbox", { name: "العنوان بالتفصيل أو أقرب نقطة دالة" })
    .fill("عنوان محلي مفصل للاختبار");
}

test("without a store number the WhatsApp option is hidden", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openCheckout(page);
  await expect(
    page.getByRole("button", { name: "إرسال الطلب عبر واتساب" }),
  ).toHaveCount(0);
});

test("phone: the owner sets the number, a customer sends the order through WhatsApp", async ({
  page,
  context,
}) => {
  const issues = trackPageIssues(page);
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
  await openCheckout(page);
  await page.getByLabel("أقرب معلم").fill("قرب المسجد الكبير");
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: `${SHOTS}/checkout-390.png`, fullPage: true });
  await page.getByRole("button", { name: "إرسال الطلب عبر واتساب" }).click();
  await expect(page).toHaveURL(
    /\/orders\/MS-[A-Za-z0-9_-]{24}\/confirmation$/,
    {
      timeout: 15_000,
    },
  );
  const reference = /orders\/(MS-[^/]+)\//.exec(page.url())![1]!;

  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "خطوة أخيرة: أرسل الطلب على واتساب",
    }),
  ).toBeVisible();
  await expect(page.getByText("بانتظار تأكيد واتساب")).toBeVisible();
  const lines = page.getByRole("list", { name: "منتجات الطلب" });
  await expect(lines.getByRole("listitem")).toHaveCount(1);
  await expect(lines).toContainText("× 1");

  const handoff = page.getByRole("region", {
    name: "أرسل الطلب على واتساب لتأكيده",
  });
  const app = await handoff
    .getByRole("link", { name: "فتح واتساب" })
    .getAttribute("href");
  expect(app).toMatch(/^https:\/\/wa\.me\/970590000000\?text=/);
  const text = decodeURIComponent(app!.split("text=")[1]!);
  expect(text).toContain(reference);
  // The message never carries the customer's own details.
  expect(text).not.toMatch(/0591234567|عنوان محلي|عميل واتساب|قرب المسجد/);
  await expect(
    handoff.getByRole("link", { name: "واتساب ويب" }),
  ).toHaveAttribute(
    "href",
    /^https:\/\/web\.whatsapp\.com\/send\?phone=970590000000&text=/,
  );
  await expect(handoff.getByLabel("نص الرسالة")).toHaveValue(text);
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
      { status: string; checkout_channel: string; landmark: string | null }[]
    >`
      select status, checkout_channel, landmark from orders
      where public_reference = ${reference}`,
  );
  expect(order).toEqual({
    status: "awaiting_whatsapp",
    checkout_channel: "whatsapp",
    landmark: "قرب المسجد الكبير",
  });

  // The owner sees it waiting and can confirm it like any new order.
  await login(page);
  await page.goto(`/admin/orders/${reference}`);
  await expect(page.getByText("بانتظار تأكيد واتساب").first()).toBeVisible();
  await expect(page.getByText("قرب المسجد الكبير")).toBeVisible();
  expect(issues.consoleErrors).toEqual([]);
});
