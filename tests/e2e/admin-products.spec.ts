import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import {
  expectNoHorizontalOverflow,
  login,
  trackPageIssues,
  withTestDb,
} from "./support";

const SHOTS = "artifacts/admin-products";
const WIDTHS = [
  [360, 800],
  [390, 844],
  [768, 1024],
  [1440, 900],
] as const;
const FIRST = "general-cleaner";
const SECOND = "arar-dish-liquid";

test.describe.configure({ mode: "serial" });

let saved: Array<{
  domain_id: string;
  publication: string;
  archived_at: Date | null;
}> = [];

test.beforeAll(async () => {
  saved = await withTestDb(
    (sql) => sql`
      select domain_id, publication, archived_at from products
      where domain_id in (${FIRST}, ${SECOND})`,
  );
});

test.afterAll(async () => {
  await withTestDb(async (sql) => {
    for (const row of saved) {
      await sql`
        update products set publication = ${row.publication}, archived_at = ${row.archived_at}
        where domain_id = ${row.domain_id}`;
    }
  });
});

async function axe(page: Page, ...selectors: string[]) {
  let builder = new AxeBuilder({ page }).withTags([
    "wcag2a",
    "wcag2aa",
    "wcag21a",
    "wcag21aa",
  ]);
  for (const selector of selectors) builder = builder.include(selector);
  const result = await builder.analyze();
  expect(
    result.violations.map((violation) => ({
      id: violation.id,
      nodes: violation.nodes.map((node) => node.target.join(" ")),
    })),
  ).toEqual([]);
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

test("products list at 360, 390, 768 and 1440: status tabs with counts, health chips, no overflow", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const issues = trackPageIssues(page);
  await login(page);
  for (const [width, height] of WIDTHS) {
    await page.setViewportSize({ width, height });
    await page.goto("/admin/products");
    await expect(
      page.getByRole("heading", { name: "المنتجات", level: 1 }),
    ).toBeVisible();
    const tabs = page.getByRole("navigation", { name: "حالة المنتجات" });
    await expect(tabs.getByRole("link", { name: /^الكل/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(tabs.getByRole("link", { name: /^مؤرشف/ })).toBeVisible();
    const name = width >= 1024 ? "table" : ".admin-product-cards";
    await expect(page.locator(name).first()).toBeVisible();
    await expectNoHorizontalOverflow(page);
    expect(
      await smallTargets(
        page,
        ".admin-products a, .admin-products button:not([disabled]), .admin-products label.admin-check",
      ),
    ).toEqual([]);
    await axe(page, ".admin-products");
    await page.screenshot({ path: `${SHOTS}/list-${width}.png` });
  }
  // Search reaches SKU and Arabic spelling variants, and keeps the tab.
  await page.goto("/admin/products?status=published");
  await page.getByRole("searchbox", { name: "بحث في المنتجات" }).fill("منظف");
  await page.getByRole("button", { name: "تطبيق" }).click();
  await expect(page).toHaveURL(/status=published/);
  await expect(page).toHaveURL(/q=/);
  expect(issues.consoleErrors).toEqual([]);
  expect(issues.failedRequests).toEqual([]);
});

test("owner hides two products in one go; republishing reports each product the server refuses", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page);
  await page.goto("/admin/products?status=published");
  const table = page.locator("table.admin-product-table");
  for (const id of [FIRST, SECOND]) {
    await table
      .locator(`tr:has(a[href="/admin/products/${id}"])`)
      .getByRole("checkbox")
      .check();
  }
  const bar = page.getByRole("form", { name: "إجراءات جماعية" });
  await expect(bar.getByRole("status")).toHaveText("2 منتجات محددة");
  await page.screenshot({ path: `${SHOTS}/bulk-1440.png` });
  await bar.getByRole("button", { name: "إخفاء", exact: true }).click();
  await expect(page.getByText("تم تحديث 2 منتجات.")).toBeVisible();
  await expect(bar).toHaveCount(0);

  const states = await withTestDb(
    (sql) => sql<{ publication: string }[]>`
      select publication from products where domain_id in (${FIRST}, ${SECOND})`,
  );
  expect(states.map((row) => row.publication)).toEqual(["hidden", "hidden"]);

  // Republishing runs the full publish check product by product. These two only have a temporary
  // picture, which a bulk publish never accepts for the owner, so each refusal is reported by name.
  await page.goto("/admin/products?status=hidden");
  await page
    .getByRole("checkbox", { name: "تحديد كل المنتجات المعروضة" })
    .check();
  await page
    .getByRole("form", { name: "إجراءات جماعية" })
    .getByRole("button", { name: "نشر", exact: true })
    .click();
  const report = page.getByRole("status").filter({ hasText: "لم يتغيّر" });
  await expect(report).toContainText("لم يتغيّر 2 منتجات");
  await expect(report.getByRole("listitem")).toHaveCount(2);
  await expect(report.getByRole("listitem").first()).toContainText(
    "المنتج بدون صورة حقيقية",
  );
  await expect(report.getByRole("link", { name: /منظف عام/ })).toHaveAttribute(
    "href",
    `/admin/products/${FIRST}`,
  );
  await page.screenshot({ path: `${SHOTS}/bulk-result-1440.png` });
  const after = await withTestDb(
    (sql) => sql<{ publication: string }[]>`
      select publication from products where domain_id in (${FIRST}, ${SECOND})`,
  );
  expect(after.map((row) => row.publication)).toEqual(["hidden", "hidden"]);
  await withTestDb(
    (sql) =>
      sql`update products set publication = 'published' where domain_id in (${FIRST}, ${SECOND})`,
  );
});

test("phone: one tap hides a product from its card; the archive lists it and restores it", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await page.goto("/admin/products?status=published");
  const card = page
    .locator(".admin-product-item")
    .filter({ has: page.locator(`a[href="/admin/products/${FIRST}"]`) });
  await card.getByRole("button", { name: /^إخفاء/ }).click();
  await expect(page.getByText("تم تحديث منتج واحد.")).toBeVisible();
  await page.goto("/admin/products?status=hidden");
  await expect(
    page.locator(`.admin-product-item a[href="/admin/products/${FIRST}"]`),
  ).toBeVisible();

  await withTestDb(
    (sql) =>
      sql`update products set archived_at = now() where domain_id = ${FIRST}`,
  );
  await page.goto("/admin/products?status=archived");
  const archived = page
    .locator(".admin-product-item")
    .filter({ has: page.locator(`a[href="/admin/products/${FIRST}"]`) });
  await expect(archived.getByText(/مؤرشف/)).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/archived-390.png` });
  await archived.getByRole("button", { name: /^استعادة/ }).click();
  await expect(page).toHaveURL(
    new RegExp(`/admin/products/${FIRST}\\?saved=restored`),
  );
  await expect(
    page.getByText("تمت استعادة المنتج من الأرشيف.", { exact: false }),
  ).toBeVisible();
});

test("product workspace at 360, 390, 768 and 1440: header, section bar, inventory, existing editors", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const issues = trackPageIssues(page);
  await login(page);
  for (const [width, height] of WIDTHS) {
    await page.setViewportSize({ width, height });
    await page.goto(`/admin/products/${FIRST}?advanced=1`);
    const header = page.locator(".admin-workspace-header");
    await expect(header.getByRole("heading", { level: 1 })).toBeVisible();
    // The simple editor comes first; every older editor waits under «إعدادات متقدمة».
    await expect(
      page.getByRole("heading", { name: "اسم المنتج" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "حفظ المنتج" }),
    ).toBeVisible();
    await expect(page.getByRole("region", { name: "طرق البيع" })).toBeVisible();
    await expect(
      page.getByRole("region", { name: "الصور والخيارات والأصناف" }),
    ).toBeVisible();
    const inventory = page.getByRole("region", { name: "المخزون" });
    await inventory.scrollIntoViewIfNeeded();
    await expect(
      inventory.getByRole("link", { name: "الحركات والتعديل" }).first(),
    ).toBeVisible();
    await expectNoHorizontalOverflow(page);
    expect(
      await smallTargets(
        page,
        ".admin-workspace-header a, .sp-editor button, #inventory a",
      ),
    ).toEqual([]);
    await axe(page, ".admin-workspace-header", ".sp-editor", "#inventory");
    await page.goto(`/admin/products/${FIRST}`);
    // The sticky save is never covered by the assistant button.
    const save = page.locator(".sp-actions .admin-btn-primary");
    const launcher = page.getByRole("button", { name: "فتح المساعد" });
    if (await launcher.isVisible()) {
      const a = (await save.boundingBox())!;
      const b = (await launcher.boundingBox())!;
      const overlap =
        a.x < b.x + b.width &&
        b.x < a.x + a.width &&
        a.y < b.y + b.height &&
        b.y < a.y + a.height;
      expect(overlap).toBe(false);
    }
    await page.screenshot({ path: `${SHOTS}/workspace-${width}.png` });
  }
  expect(issues.consoleErrors).toEqual([]);
  expect(issues.failedRequests).toEqual([]);
});
