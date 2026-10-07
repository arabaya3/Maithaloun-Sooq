import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { expectNoHorizontalOverflow, login, trackPageIssues } from "./support";

const SHOTS = "artifacts/admin-shell";
const WIDTHS = [
  [360, 800],
  [390, 844],
  [768, 1024],
  [1440, 900],
] as const;
// One page per area, so each group's selected state is seen.
const PAGES = [
  ["today", "/admin", "اليوم"],
  ["orders", "/admin/orders", "الطلبات"],
  ["inventory", "/admin/inventory", "المخزون"],
  ["products", "/admin/products", "المنتجات"],
] as const;

async function expectTargets(page: Page, selector: string) {
  const small = await page.locator(selector).evaluateAll((nodes) =>
    nodes
      .filter((node) => (node as HTMLElement).offsetParent !== null)
      .map((node) => {
        const box = node.getBoundingClientRect();
        return { text: node.textContent?.trim(), w: box.width, h: box.height };
      })
      .filter((box) => box.w < 44 || box.h < 44),
  );
  expect(small).toEqual([]);
}

async function expectShellAccessible(page: Page) {
  const result = await new AxeBuilder({ page })
    .include(".admin-sidebar")
    .include(".admin-topbar")
    .include(".admin-mobile-header")
    .include(".admin-bottom-nav")
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(
    result.violations.map((violation) => ({
      id: violation.id,
      nodes: violation.nodes.map((node) => node.target.join(" ")),
    })),
  ).toEqual([]);
}

test.describe.configure({ mode: "serial" });

test("shell at 360, 390, 768 and 1440: areas, targets, Cairo, contrast and no overflow", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const issues = trackPageIssues(page);
  await login(page);
  // Cairo is the face actually used, not only declared.
  expect(
    await page.evaluate(async () => {
      await document.fonts.ready;
      return [...document.fonts]
        .filter((face) => face.status === "loaded")
        .map((face) => face.family)
        .join(" ");
    }),
  ).toMatch(/cairo/i);

  for (const [width, height] of WIDTHS) {
    await page.setViewportSize({ width, height });
    for (const [key, path, area] of PAGES) {
      await page.goto(path);
      await expect(page.locator(".admin-body h1").first()).toBeVisible();
      await expectNoHorizontalOverflow(page);
      if (width >= 1024) {
        const sidebar = page.locator(".admin-sidebar");
        await expect(sidebar).toBeVisible();
        expect((await sidebar.boundingBox())!.width).toBe(260);
        await expect(
          page.getByRole("navigation", { name: "التنقل السفلي" }),
        ).toBeHidden();
        await expect(
          sidebar.getByRole("link", { name: area, exact: true }),
        ).toHaveAttribute("aria-current", "page");
        const topbar = (await page.locator(".admin-topbar").boundingBox())!;
        expect(topbar.height).toBeGreaterThanOrEqual(64);
        expect(topbar.height).toBeLessThanOrEqual(72);
        await expectTargets(page, ".admin-sidebar a, .admin-sidebar summary");
        // The assistant floats beside the sidebar, never over it.
        const launcher = page.getByRole("button", { name: "فتح المساعد" });
        if (await launcher.isVisible()) {
          const box = (await launcher.boundingBox())!;
          const rail = (await sidebar.boundingBox())!;
          expect(box.x + box.width).toBeLessThanOrEqual(rail.x);
        }
      } else {
        await expect(page.locator(".admin-sidebar")).toBeHidden();
        const nav = page.getByRole("navigation", { name: "التنقل السفلي" });
        await expect(nav.getByRole("link")).toHaveText(["اليوم"]);
        await expect(nav.getByRole("button")).toHaveText([
          "البيع",
          "المخزون",
          "الكتالوج",
          "المزيد",
        ]);
        const selected =
          key === "today"
            ? nav.getByRole("link", { name: "اليوم" })
            : nav.getByRole("button", {
                name: {
                  orders: "البيع",
                  inventory: "المخزون",
                  products: "الكتالوج",
                }[key],
              });
        await expect(selected).toHaveAttribute(
          key === "today" ? "aria-current" : "data-active",
          key === "today" ? "page" : "true",
        );
        await expectTargets(
          page,
          ".admin-bottom-nav a, .admin-bottom-nav button, .admin-mobile-header a, .admin-mobile-header button",
        );
      }
      await expectShellAccessible(page);
      await page.screenshot({ path: `${SHOTS}/${key}-${width}.png` });
    }
  }
  expect(issues.consoleErrors).toEqual([]);
  expect(issues.failedRequests).toEqual([]);
});

test("phone: every area sheet lists its pages, closes with Escape and returns focus", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const issues = trackPageIssues(page);
  await login(page);
  const nav = page.getByRole("navigation", { name: "التنقل السفلي" });
  const expected: Record<string, string[]> = {
    البيع: ["الطلبات", "المبيعات", "الزبائن والديون"],
    المخزون: [
      "المخزون",
      "فواتير الشراء",
      "تصوير فاتورة شراء",
      "رفع Excel",
      "مراجعة أسعار البيع",
      "الموردون",
    ],
    الكتالوج: ["المنتجات", "الأقسام", "العروض"],
    المزيد: [
      "التقارير",
      "الإشعارات",
      "تسجيل عملية بالصوت",
      "إعدادات المتجر",
      "سجل التدقيق",
      "فحص المساعد",
      "العودة إلى المتجر",
    ],
  };
  for (const [area, links] of Object.entries(expected)) {
    const button = nav.getByRole("button", { name: area });
    await button.click();
    const sheet = page.getByRole("dialog", { name: area });
    await expect(sheet.getByRole("link")).toHaveText(links);
    await page.screenshot({ path: `${SHOTS}/sheet-${links[0]}-390.png` });
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    await expect(button).toBeFocused();
  }

  const add = page
    .locator(".admin-mobile-header")
    .getByRole("button", { name: "إضافة" });
  await add.click();
  await expect(
    page.getByRole("dialog", { name: "ماذا تريدين أن تضيفي؟" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(add).toBeFocused();

  // A sheet link navigates and the sheet closes on arrival.
  await nav.getByRole("button", { name: "الكتالوج" }).click();
  await page
    .getByRole("dialog", { name: "الكتالوج" })
    .getByRole("link", { name: "الأقسام" })
    .click();
  await expect(page).toHaveURL(/\/admin\/categories$/);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(nav.getByRole("button", { name: "الكتالوج" })).toHaveAttribute(
    "data-active",
    "true",
  );
  expect(issues.consoleErrors).toEqual([]);
});

test("desktop: keyboard reaches every area in RTL order and the management group expands", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page);
  const sidebar = page.locator(".admin-sidebar");
  await expect(sidebar.locator(".admin-nav-group-label")).toHaveText([
    "البيع",
    "المخزون",
    "الكتالوج",
    "الإدارة",
  ]);
  const manage = sidebar.locator("details.admin-nav-group-expandable");
  await expect(manage).not.toHaveAttribute("open");
  await sidebar.getByRole("link", { name: "اليوم" }).focus();
  await page.keyboard.press("Tab");
  await expect(sidebar.getByRole("link", { name: "الطلبات" })).toBeFocused();
  await manage.locator("summary").focus();
  await page.keyboard.press("Enter");
  await expect(manage).toHaveAttribute("open");
  await manage.getByRole("link", { name: "التقارير" }).click();
  await expect(page).toHaveURL(/\/admin\/reports$/);
  // The management group stays open while one of its pages is shown.
  await expect(
    page.locator(".admin-sidebar details.admin-nav-group-expandable"),
  ).toHaveAttribute("open");
  await page.screenshot({ path: `${SHOTS}/reports-1440.png` });
});
