import { expect, test } from "@playwright/test";

import { login, trackPageIssues, withTestDb } from "./support";

const NAME = "منتج تجربة مخزون المعالج";

// Runs late on purpose: stock movements are append-only, so this product keeps its history and is archived.
test.afterAll(async () => {
  await withTestDb(
    (sql) => sql`
      update products set archived_at = now(), publication = 'hidden'
      where name_ar = ${NAME}`,
  );
});

test("phone: opening stock belongs to one exact variant and is never copied", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const issues = trackPageIssues(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await page.goto("/admin/products/new");
  await page.getByLabel("اسم المنتج بالعربية").fill(NAME);
  await page.getByLabel("القسم").selectOption({ index: 1 });
  await page.getByLabel("سعر البيع ₪").fill("5");
  await page.getByRole("button", { name: "التالي: الخيارات والمخزون" }).click();
  await expect(page).toHaveURL(/step=2$/, { timeout: 15_000 });
  const domainId = /product=([a-z0-9-]+)/.exec(page.url())![1]!;

  await page.getByRole("radio", { name: "أحجام متعددة" }).check();
  await page.getByLabel("أضيفي قيمة لـ الحجم").fill("صغير، كبير");
  await page.getByLabel("أضيفي قيمة لـ الحجم").press("Enter");
  await page.getByRole("button", { name: "التالي: الصور" }).click();
  await expect(page).toHaveURL(/guide=images/, { timeout: 15_000 });

  await page.goto(`/admin/products/${domainId}?guide=prices#wizard-prices`);
  const card = page.getByRole("form", { name: "كبير" });
  await card.getByLabel("الكمية الافتتاحية").fill("4");
  await card.getByLabel("نبّهيني عند الوصول إلى").fill("1");
  await card.getByRole("button", { name: "حفظ الصنف" }).click();
  // Opening stock without its cost is refused, so profit can always be calculated.
  await expect(card.getByRole("alert")).toHaveText(
    "اكتبي تكلفة القطعة للكمية الافتتاحية.",
  );
  await card.getByLabel("تكلفة القطعة (₪)").fill("3");
  await card.getByRole("button", { name: "حفظ الصنف" }).click();
  await expect(card.getByRole("status")).toHaveText("حُفظ هذا الصنف.");

  const stock = await withTestDb(
    (sql) => sql<
      { label: string; on_hand: number | null; threshold: number | null }[]
    >`
      select v.label_ar as label, i.on_hand_milli as on_hand,
        i.reorder_threshold_milli as threshold
      from product_variants v join products p on p.id = v.product_id
      left join inventory_items i on i.variant_id = v.id
      where p.domain_id = ${domainId} and v.archived_at is null order by v.label_ar`,
  );
  expect(
    stock.map((row) => [row.label, row.on_hand ?? 0, row.threshold]),
  ).toEqual([
    ["صغير", 0, null],
    ["كبير", 4000, 1000],
  ]);

  // Once tracked, the card records a counted correction instead of a second opening balance.
  await expect(
    page.getByRole("form", { name: "كبير" }).getByLabel("الكمية المعدودة الآن"),
  ).toBeVisible();
  expect(issues.consoleErrors).toEqual([]);
});
