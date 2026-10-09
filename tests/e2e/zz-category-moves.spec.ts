import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import {
  expectNoHorizontalOverflow,
  login,
  trackPageIssues,
  withTestDb,
} from "./support";

const SHOTS = "artifacts/category-moves";
const CATEGORY = "قسم نقل تجريبي";

test.afterAll(async () => {
  await withTestDb(async (sql) => {
    await sql`update products set category_id = 'tools' where domain_id = 'carpet-brush'`;
    await sql`delete from product_categories where name_ar = ${CATEGORY}`;
  });
});

test("phone: the owner moves a product to a new category, then archives the emptied one", async ({
  page,
}) => {
  const issues = trackPageIssues(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await page.goto("/admin/categories");
  await page.getByLabel("اسم القسم").fill(CATEGORY);
  await page
    .getByLabel("الرمز (اختياري، أحرف لاتينية صغيرة)")
    .fill("e2e-moves");
  await page.getByRole("button", { name: "إضافة القسم" }).click();
  await expect(page.getByText("تمت إضافة القسم.")).toBeVisible();

  const tools = page.getByRole("listitem", { name: /^القسم أدوات/ });
  await tools.getByRole("link", { name: "نقل منتجات هذا القسم" }).click();
  await expect(page).toHaveURL(/\/admin\/categories\/tools$/);
  await page.getByRole("checkbox", { name: /فرشاة سجاد/ }).check();
  await page.getByLabel("القسم الجديد").selectOption({ label: CATEGORY });
  await page.getByRole("button", { name: "نقل المنتجات المحددة" }).click();
  await expect(
    page.locator(".admin-category-mover").getByRole("alert"),
  ).toContainText(`إلى «${CATEGORY}»؟`);
  await expectNoHorizontalOverflow(page);
  const axe = await new AxeBuilder({ page })
    .include("main")
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(axe.violations.map((violation) => violation.id)).toEqual([]);
  await page.screenshot({ path: `${SHOTS}/confirm-390.png`, fullPage: true });
  await page.getByRole("button", { name: "تأكيد النقل" }).click();
  await expect(
    page.locator(".admin-category-mover").getByRole("status"),
  ).toHaveText(`نُقل 1 منتج إلى «${CATEGORY}».`);
  await expect(page.getByRole("checkbox", { name: /فرشاة سجاد/ })).toHaveCount(
    0,
  );

  const [moved] = await withTestDb(
    (sql) => sql<{ category_id: string }[]>`
      select category_id from products where domain_id = 'carpet-brush'`,
  );
  expect(moved!.category_id).toBe("e2e-moves");
  const [audit] = await withTestDb(
    (sql) => sql<{ total: number }[]>`
      select count(*)::int as total from admin_audit_events
      where action_type = 'product_category_move' and entity_id = 'carpet-brush'`,
  );
  expect(audit!.total).toBeGreaterThan(0);

  // Moving it back empties the new category, which can then be archived.
  await page.goto("/admin/categories/e2e-moves");
  await page.getByRole("checkbox", { name: "تحديد الكل" }).check();
  await page.getByLabel("القسم الجديد").selectOption("tools");
  await page.getByRole("button", { name: "نقل المنتجات المحددة" }).click();
  await page.getByRole("button", { name: "تأكيد النقل" }).click();
  await expect(
    page.getByText("لا توجد منتجات فعّالة في هذا القسم."),
  ).toBeVisible();
  await page.goto("/admin/categories");
  const row = page.getByRole("listitem", { name: `القسم ${CATEGORY}` });
  await expect(row).toContainText("0 منتج");
  await row.getByText("تعديل وإجراءات").click();
  await expect(row.getByRole("button", { name: "أرشفة القسم" })).toBeEnabled();
  expect(issues.consoleErrors).toEqual([]);
});
