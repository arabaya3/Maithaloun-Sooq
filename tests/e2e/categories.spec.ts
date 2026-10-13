import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import {
  expectNoHorizontalOverflow,
  trackPageIssues,
  withTestDb,
} from "./support";

const SHOTS = "artifacts/categories";

async function publishedCounts() {
  const rows = await withTestDb(
    (sql) => sql<{ code: string; name_ar: string; count: number }[]>`
      select c.code, c.name_ar, count(p.id)::int as count
      from product_categories c
      left join products p
        on p.category_id = c.code
        and p.publication = 'published'
        and p.archived_at is null
      where c.archived_at is null and c.visible
      group by c.code, c.name_ar, c.sort_order
      order by c.sort_order, c.code`,
  );
  return rows;
}

test("lists every visible category with its published product count", async ({
  page,
}) => {
  const issues = trackPageIssues(page);
  const expected = await publishedCounts();
  await page.goto("/categories");
  await expect(
    page.getByRole("heading", { level: 1, name: "الأقسام" }),
  ).toBeVisible();
  const links = page.locator(".category-directory a");
  await expect(links).toHaveCount(expected.length);
  for (const [index, category] of expected.entries()) {
    const link = links.nth(index);
    await expect(link).toHaveAttribute("href", `/categories/${category.code}`);
    await expect(link).toContainText(category.name_ar);
  }
  // «الأقسام» stays the current navigation item on the list and inside a category.
  await expect(
    page.locator('a[aria-current="page"][href="/categories"]'),
  ).not.toHaveCount(0);

  const withProducts = expected.find((category) => category.count > 0)!;
  await page
    .locator(`.category-directory a[href="/categories/${withProducts.code}"]`)
    .click();
  await expect(page).toHaveURL(new RegExp(`/categories/${withProducts.code}$`));
  await expect(
    page.getByRole("heading", { level: 1, name: withProducts.name_ar }),
  ).toBeVisible();
  await expect(page.locator("article[data-product-id]")).toHaveCount(
    withProducts.count,
  );
  await expect(
    page.locator('a[aria-current="page"][href="/categories"]'),
  ).not.toHaveCount(0);
  expect(issues.consoleErrors).toEqual([]);
});

test("unknown, hidden and archived codes are not found", async ({ page }) => {
  const [hidden] = await publishedCounts();
  expect((await page.goto("/categories/no-such-category"))?.status()).toBe(404);
  expect((await page.goto("/categories/%3Cscript%3E"))?.status()).toBe(404);
  try {
    await withTestDb(
      (sql) =>
        sql`update product_categories set visible = false where code = ${hidden!.code}`,
    );
    expect((await page.goto(`/categories/${hidden!.code}`))?.status()).toBe(
      404,
    );
    await page.goto("/categories");
    await expect(
      page.locator(`.category-directory a[href="/categories/${hidden!.code}"]`),
    ).toHaveCount(0);
    // The home page ignores a hidden category in its address and shows everything.
    await page.goto(`/?category=${hidden!.code}`);
    await expect(
      page.locator('.category-item[data-category-id="all"]'),
    ).toHaveAttribute("aria-pressed", "true");
  } finally {
    await withTestDb(
      (sql) =>
        sql`update product_categories set visible = true where code = ${hidden!.code}`,
    );
  }
});

test("the home page keeps the chosen category in its address", async ({
  page,
}) => {
  const [first] = (await publishedCounts()).filter((item) => item.count > 0);
  await page.goto("/");
  await page.locator(`[data-category-id="${first!.code}"]`).click();
  await expect(page).toHaveURL(new RegExp(`\\?category=${first!.code}$`));
  await page.reload();
  await expect(
    page.locator(`[data-category-id="${first!.code}"]`),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("article[data-product-id]")).toHaveCount(
    Math.min(first!.count, 12),
  );
  await page.locator('[data-category-id="all"]').click();
  await expect(page).toHaveURL(/\/$/);
});

for (const width of [360, 390, 768, 1440]) {
  test(`categories at ${width}px: no overflow, accessible`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width < 768 ? 844 : 900 });
    await page.goto("/categories");
    await expectNoHorizontalOverflow(page);
    const axe = await new AxeBuilder({ page })
      .include("main")
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(axe.violations.map((violation) => violation.id)).toEqual([]);
    if (width === 390 || width === 1440) {
      await page.screenshot({
        path: `${SHOTS}/categories-${width}.png`,
        fullPage: true,
      });
      await page.goto("/");
      await page
        .locator('[data-product-id="general-cleaner"]')
        .getByRole("button", { name: "أضف إلى السلة" })
        .click();
      await page.goto("/cart");
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: `${SHOTS}/cart-${width}.png` });
    }
  });
}
