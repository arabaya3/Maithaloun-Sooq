import { expect, test } from "@playwright/test";

import { expectNoHorizontalOverflow, login, withTestDb } from "./support";

const SHOTS = "artifacts/store-ops";

async function salePrice() {
  const rows = await withTestDb(
    (sql) => sql<{ price_agorot: number }[]>`
      select price_agorot from product_variants
      where domain_id = 'lilac-floor-cleaner--default'
    `,
  );
  return rows[0]!.price_agorot;
}

async function buy(page: import("@playwright/test").Page, cost: string) {
  await page.goto("/admin/inventory/purchases/new");
  await page
    .getByRole("combobox", { name: "المورد" })
    .selectOption({ label: "+ مورد جديد" });
  await page.getByLabel("اسم المورد الجديد").fill("مورد الأرضيات");
  await page.getByRole("button", { name: /منتج السطر 1/ }).click();
  const picker = page.getByRole("dialog", { name: "منتج السطر 1" });
  await picker.getByRole("searchbox", { name: "بحث عن منتج" }).fill("Lilac");
  await picker.getByRole("button", { name: /Lilac/ }).click();
  await page.getByLabel(/^الكمية/).fill("5");
  await page.getByLabel(/سعر الشراء/).fill(cost);
  await page.getByRole("button", { name: "مراجعة الفاتورة" }).click();
  const acknowledge = page.getByRole("checkbox");
  if (await acknowledge.isVisible().catch(() => false)) {
    await acknowledge.check();
  }
  await page.getByRole("button", { name: "تأكيد وحفظ في المخزون" }).click();
  await expect(
    page.getByRole("heading", { name: "تم حفظ فاتورة الشراء" }),
  ).toBeVisible({ timeout: 15_000 });
}

test("owner reviews a cost increase and decides the sale price", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await login(page);
  await buy(page, "6");
  await buy(page, "9.50");
  // The success screen already compares the new cost with the sale price.
  await expect(page.getByText("هامش ربح ضعيف")).toBeVisible();
  expect(await salePrice()).toBe(1_000);

  await page.goto("/admin/inventory");
  await page.getByRole("link", { name: /تغيّرت تكلفته/ }).click();
  await expect(
    page.getByRole("heading", { name: "مراجعة أسعار البيع", level: 1 }),
  ).toBeVisible();
  const card = page
    .getByRole("list", { name: "أصناف تحتاج مراجعة السعر" })
    .getByRole("listitem")
    .filter({ hasText: "Lilac" });
  await expect(card).toContainText("التكلفة السابقة");
  await expect(card).toContainText("هامش ربح ضعيف");
  await expectNoHorizontalOverflow(page);
  await page.screenshot({
    path: `${SHOTS}/price-review-390.png`,
    fullPage: true,
  });

  await card.getByRole("button", { name: "تعديل سعر البيع" }).click();
  await card.getByLabel("سعر البيع الجديد ₪").fill("13.50");
  await card.getByRole("button", { name: "حفظ السعر الجديد" }).click();
  await expect(card).toHaveCount(0);
  expect(await salePrice()).toBe(1_350);
});
