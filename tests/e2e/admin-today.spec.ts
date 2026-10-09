import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { expectNoHorizontalOverflow, login, trackPageIssues } from "./support";

const SHOTS = "artifacts/admin-today";
const CUSTOMER = "زبونة لوحة اليوم";
const WIDTHS = [
  [360, 800],
  [390, 844],
  [768, 1024],
  [1440, 900],
] as const;

test.describe.configure({ mode: "serial" });

let reference = "";

async function placeOrder(page: Page) {
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
  await page.getByLabel("الاسم الكامل").fill(CUSTOMER);
  await page.getByLabel("الرقم المحلي").fill("0599111222");
  await page
    .getByLabel("العنوان بالتفصيل أو أقرب نقطة دالة")
    .fill("ميثلون الحي الشرقي قرب الساحة");
  await page.getByRole("button", { name: /تأكيد الطلب|إرسال الطلب/ }).click();
  await expect(page).toHaveURL(/\/orders\/.+\/confirmation/);
  reference = /\/orders\/([^/]+)\/confirmation/.exec(page.url())![1]!;
}

async function smallTargets(page: Page, selector: string) {
  return page.locator(selector).evaluateAll((nodes) =>
    nodes
      .filter((node) => (node as HTMLElement).offsetParent !== null)
      .map((node) => {
        const box = node.getBoundingClientRect();
        return { text: node.textContent?.trim(), w: box.width, h: box.height };
      })
      .filter((box) => box.w < 44 || box.h < 44),
  );
}

test("اليوم at 360, 390, 768 and 1440: summary, needs action, timeline, actions, alerts", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const issues = trackPageIssues(page);
  await placeOrder(page);
  await login(page);

  for (const [width, height] of WIDTHS) {
    await page.setViewportSize({ width, height });
    await page.goto("/admin");
    await expect(
      page.getByRole("heading", { name: "اليوم", level: 1 }),
    ).toBeVisible();
    const summary = page.getByRole("region", { name: "ملخص اليوم" });
    // The owner sees the day's money from the report service.
    await expect(summary.getByText("المبيعات اليوم")).toBeVisible();
    await expect(summary.getByText("الربح اليوم")).toBeVisible();
    await expect(
      summary.getByRole("link", { name: /طلبات اليوم/ }),
    ).toBeVisible();

    const needs = page.getByRole("region", { name: "تحتاج إجراء الآن" });
    await expect(needs.getByText(CUSTOMER)).toBeVisible();
    // The next-action label must be readable on its button, not forest on forest.
    const next = needs.locator(".admin-btn-primary").first();
    const colours = await next.evaluate((node) => {
      const label = node.querySelector(".admin-next-label") ?? node;
      return [
        getComputedStyle(label).color,
        getComputedStyle(node).backgroundColor,
      ];
    });
    expect(colours[0]).not.toBe(colours[1]);
    await expect(next).toHaveText(/\S/);
    const timeline = page.getByRole("region", { name: "مهام اليوم" });
    const item = timeline.getByRole("link", { name: new RegExp(CUSTOMER) });
    await expect(item).toBeVisible();
    await expect(item).toHaveAttribute("href", `/admin/orders/${reference}`);
    await expect(item.getByText("جديد")).toBeVisible();

    const actions = page.getByRole("region", { name: "إجراءات سريعة" });
    await expect(
      actions.getByRole("link", { name: "إضافة منتج" }),
    ).toBeVisible();
    await expect(actions.getByRole("link", { name: "بيع سريع" })).toBeVisible();
    // Seven days of sales, a bar per day, and the week's best sellers.
    const week = page.getByRole("region", { name: "آخر 7 أيام" });
    await expect(week).toBeVisible({ timeout: 20_000 });
    await expect(
      week
        .getByRole("list", { name: "المبيعات اليومية" })
        .getByRole("listitem"),
    ).toHaveCount(7);

    await expectNoHorizontalOverflow(page);
    expect(
      await smallTargets(page, ".admin-today a, .admin-today button"),
    ).toEqual([]);
    const axe = await new AxeBuilder({ page })
      .include(".admin-today")
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(
      axe.violations.map((violation) => ({
        id: violation.id,
        nodes: violation.nodes.map((node) => node.target.join(" ")),
      })),
    ).toEqual([]);

    if (width < 1024) {
      // The one primary action stays reachable above the bottom bar, and nothing floats over it.
      const sticky = (await page
        .locator(".admin-sticky-action")
        .boundingBox())!;
      const nav = (await page
        .getByRole("navigation", { name: "التنقل السفلي" })
        .boundingBox())!;
      expect(sticky.y + sticky.height).toBeLessThanOrEqual(nav.y + 1);
      expect(sticky.y + sticky.height).toBeGreaterThan(height - 200);
      const launcher = page.getByRole("button", { name: "فتح المساعد" });
      if (await launcher.isVisible()) {
        const box = (await launcher.boundingBox())!;
        expect(box.y + box.height).toBeLessThanOrEqual(sticky.y);
      }
    }
    await page.screenshot({ path: `${SHOTS}/today-${width}.png` });
    await page.screenshot({
      path: `${SHOTS}/today-${width}-full.png`,
      fullPage: true,
    });
  }
  expect(issues.consoleErrors).toEqual([]);
  expect(issues.failedRequests).toEqual([]);
});

test("desktop search: grouped results, keyboard choice opens the order", async ({
  page,
}) => {
  const issues = trackPageIssues(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page);
  const input = page
    .locator(".admin-topbar")
    .getByRole("combobox", { name: "بحث في المتجر" });
  await input.click();
  await expect(
    page
      .locator(".admin-topbar")
      .getByText("اكتبي حرفين على الأقل", { exact: false }),
  ).toBeVisible();
  await input.fill("زبونة لوحة");
  const results = page.locator(".admin-topbar").getByRole("listbox");
  const orders = results.getByRole("group", { name: "الطلبات" });
  await expect(orders.getByRole("option").first()).toContainText(CUSTOMER);
  await page.screenshot({ path: `${SHOTS}/search-1440.png` });
  await input.press("ArrowDown");
  await input.press("Enter");
  await expect(page).toHaveURL(new RegExp(`/admin/orders/${reference}$`));

  await input.fill("منظف");
  await expect(
    results
      .getByRole("group", { name: "المنتجات" })
      .getByRole("option")
      .first(),
  ).toBeVisible();
  await input.fill("لا يوجد شيء بهذا الاسم");
  await expect(results.getByText(/لا توجد نتائج لـ/)).toBeVisible();
  await input.press("Escape");
  await expect(input).toHaveValue("");
  expect(issues.consoleErrors).toEqual([]);
});

test("phone search: header button opens a sheet, a result navigates and closes it", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await page
    .locator(".admin-mobile-header")
    .getByRole("button", { name: "بحث" })
    .click();
  const sheet = page.getByRole("dialog", { name: "بحث في المتجر" });
  const input = sheet.getByRole("combobox", { name: "بحث في المتجر" });
  await expect(input).toBeFocused();
  await input.fill("زبونة لوحة");
  await sheet.getByRole("option", { name: new RegExp(CUSTOMER) }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/orders/${reference}$`));
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.screenshot({ path: `${SHOTS}/search-sheet-390.png` });

  // The search is remembered on this device only.
  await page
    .locator(".admin-mobile-header")
    .getByRole("button", { name: "بحث" })
    .click();
  await expect(
    page
      .getByRole("dialog", { name: "بحث في المتجر" })
      .getByRole("button", { name: "زبونة لوحة" }),
  ).toBeVisible();
});
