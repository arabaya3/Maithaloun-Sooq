import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import sharp from "sharp";

import {
  expectNoHorizontalOverflow,
  login,
  trackPageIssues,
  withTestDb,
} from "./support";

const SHOTS = "artifacts/admin-simple-product";
const NAME = "منتج تجربة الشاشة البسيطة";

test.describe.configure({ mode: "serial" });

let domainId = "";

// Stock history is never deleted; a product with stock records is archived and hidden instead.
test.afterAll(async () => {
  await withTestDb(async (sql) => {
    await sql`
      update products p set archived_at = now(), publication = 'hidden'
      where p.name_ar like ${NAME + "%"} and exists (
        select 1 from inventory_items i join product_variants v on v.id = i.variant_id
        where v.product_id = p.id)`;
    await sql`
      delete from products p where p.name_ar like ${NAME + "%"} and not exists (
        select 1 from inventory_items i join product_variants v on v.id = i.variant_id
        where v.product_id = p.id)`;
  });
});

async function photo(background: string) {
  return {
    name: `${background.slice(1)}.png`,
    mimeType: "image/png",
    buffer: await sharp({
      create: { width: 600, height: 400, channels: 3, background },
    })
      .png()
      .toBuffer(),
  };
}

async function axe(page: Page) {
  const result = await new AxeBuilder({ page })
    .include("main")
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(
    result.violations.map((violation) => ({
      id: violation.id,
      nodes: violation.nodes.map((node) => node.target.join(" ")),
    })),
  ).toEqual([]);
}

test("new product is one screen at 360, 390, 768 and 1440", async ({
  page,
}) => {
  const issues = trackPageIssues(page);
  await login(page);
  for (const [width, height] of [
    [360, 800],
    [390, 844],
    [768, 1024],
    [1440, 900],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.goto("/admin/products/new");
    await expect(page.getByLabel("الاسم", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "حفظ ونشر في المتجر" }),
    ).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await axe(page);
    await page.screenshot({
      path: `${SHOTS}/new-${width}.png`,
      fullPage: true,
    });
  }
  await page.goto("/admin/products/new/manual");
  await expect(page).toHaveURL(/\/admin\/products\/new$/);
  expect(issues.consoleErrors).toEqual([]);
});

test("phone: three scents, each with its own photo, price and stock, published in one save", async ({
  page,
}) => {
  test.setTimeout(150_000);
  const issues = trackPageIssues(page);
  await page.setViewportSize({ width: 390, height: 844 });
  page.on("dialog", (dialog) => dialog.accept());
  await login(page);
  await page.goto("/admin/products/new");
  await page.getByLabel("الاسم", { exact: true }).fill(NAME);
  await page.getByLabel("القسم").selectOption({ index: 1 });
  await page.getByLabel("روائح", { exact: true }).check();

  const names = page.getByPlaceholder("مثل: لافندر");
  await names.nth(0).fill("لافندر");
  await names.nth(1).fill("ليمون");
  await page.getByRole("button", { name: "إضافة رائحة" }).click();
  await names.nth(2).fill("ورد");
  const prices = page.getByLabel("السعر ₪");

  // A wrong price is refused, and everything typed stays in place.
  await prices.nth(0).fill("سعر");
  await page.getByRole("button", { name: "حفظ كمسودة" }).click();
  await expect(page.locator(".sp-note[role=alert]")).toContainText(
    "اكتبي سعر «لافندر»",
  );
  await expect(names.nth(2)).toHaveValue("ورد");
  await expect(page).toHaveURL(/\/admin\/products\/new$/);

  await prices.nth(0).fill("12");
  await prices.nth(1).fill("12");
  await prices.nth(2).fill("14.50");
  await page.getByLabel("الكمية (اختياري)").nth(1).fill("4");
  await page.getByLabel("تكلفة القطعة ₪").fill("7");
  const files = page.locator('input[type="file"]');
  await files.nth(0).setInputFiles(await photo("#9b7fd1"));
  await files.nth(1).setInputFiles(await photo("#f2d33a"));
  await files.nth(2).setInputFiles(await photo("#e86a8f"));
  await expect(page.locator(".sp-photo[data-pending=true]")).toHaveCount(3);
  await page.screenshot({ path: `${SHOTS}/filled-390.png`, fullPage: true });

  await page.getByRole("button", { name: "حفظ ونشر في المتجر" }).click();
  await expect(page).toHaveURL(/\/admin\/products\/[a-z0-9-]+\?saved=ok$/, {
    timeout: 60_000,
  });
  domainId = /products\/([a-z0-9-]+)\?/.exec(page.url())![1]!;
  await expect(page.getByText("ظاهر في المتجر")).toBeVisible();

  const rows = await withTestDb(
    (sql) => sql<
      {
        label: string;
        price: number;
        on_hand: number | null;
        images: number;
      }[]
    >`
      select v.label_ar as label, v.price_agorot as price, i.on_hand_milli as on_hand,
        (select count(*)::int from product_images img
          join product_variant_option_values l on l.value_id = img.option_value_id
          where l.variant_id = v.id and img.archived_at is null) as images
      from product_variants v join products p on p.id = v.product_id
      left join inventory_items i on i.variant_id = v.id
      where p.domain_id = ${domainId} and v.archived_at is null
      order by v.sort_order`,
  );
  expect(
    rows.map((row) => [row.label, row.price, row.on_hand ?? 0, row.images]),
  ).toEqual([
    ["لافندر", 1200, 0, 1],
    ["ليمون", 1200, 4000, 1],
    ["ورد", 1450, 0, 1],
  ]);

  // Customers choose a scent and see its photo.
  await page.goto(`/products/${domainId}`);
  await expect(
    page.getByText("الرائحة: لافندر", { exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/storefront-390.png` });
  expect(issues.consoleErrors).toEqual([]);
});

test("phone: rename, remove and add a scent; the removed scent's photo leaves with it", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 390, height: 844 });
  page.on("dialog", (dialog) => dialog.accept());
  await login(page);
  await page.goto(`/admin/products/${domainId}`);
  const names = page.getByPlaceholder("مثل: لافندر");
  await names.nth(1).fill("ليمون منعش");
  await page.getByRole("button", { name: "حذف ورد" }).click();
  await page.getByRole("button", { name: "إضافة رائحة" }).click();
  await names.nth(2).fill("نعناع");
  await page.getByLabel("السعر ₪").nth(2).fill("13");
  await page
    .locator('input[type="file"]')
    .nth(2)
    .setInputFiles(await photo("#4caf7d"));
  await page.getByRole("button", { name: "حفظ", exact: true }).click();
  await expect(page.getByText("تم الحفظ.")).toBeVisible({ timeout: 60_000 });

  await page.reload();
  await expect(names).toHaveCount(3);
  expect(
    await names.evaluateAll((nodes) =>
      nodes.map((n) => (n as HTMLInputElement).value),
    ),
  ).toEqual(["لافندر", "ليمون منعش", "نعناع"]);
  const images = await withTestDb(
    (sql) => sql<{ total: number }[]>`
      select count(*)::int as total from product_images i
      join products p on p.id = i.product_id
      where p.domain_id = ${domainId} and i.archived_at is null`,
  );
  expect(images[0]!.total).toBe(3);
});

test("phone: unsaved changes are announced and can be undone; a photo can be made first", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 390, height: 844 });
  page.on("dialog", (dialog) => dialog.accept());
  await login(page);
  await page.goto(`/admin/products/${domainId}`);
  const name = page.getByLabel("الاسم", { exact: true });
  await name.fill(`${NAME} معدّل`);
  await expect(page.getByText("تغييرات غير محفوظة")).toBeVisible();
  await page.getByRole("button", { name: "تراجع" }).click();
  await expect(name).toHaveValue(NAME);
  await expect(page.getByText("تغييرات غير محفوظة")).toHaveCount(0);

  // A second photo on lavender, then made the first one.
  await page
    .locator('input[type="file"]')
    .nth(0)
    .setInputFiles(await photo("#3a2f6b"));
  await page.getByRole("button", { name: "حفظ", exact: true }).click();
  await expect(page.getByText("تم الحفظ.")).toBeVisible({ timeout: 60_000 });
  await page.reload();
  await page
    .getByRole("button", { name: "اجعلها الصورة الأولى لـ لافندر" })
    .click();
  await expect(
    page.getByRole("button", { name: "اجعلها الصورة الأولى لـ لافندر" }),
  ).toHaveCount(1);
  await expect
    .poll(async () =>
      (
        await withTestDb(
          (sql) => sql<{ alt: string }[]>`
      select i.alt_ar as alt from product_images i
      join products p on p.id = i.product_id
      join product_option_values v on v.id = i.option_value_id
      where p.domain_id = ${domainId} and v.value_ar = 'لافندر' and i.archived_at is null
      order by i.sort_order`,
        )
      ).map((row) => row.alt),
    )
    .toEqual(["3a2f6b", "9b7fd1"]);
});

test("phone: one shared photo covers every scent, so the product publishes without a photo per scent", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await page.goto("/admin/products/new");
  await page.getByLabel("الاسم", { exact: true }).fill(`${NAME} عبوة واحدة`);
  await page.getByLabel("القسم").selectOption({ index: 1 });
  await page.getByLabel("روائح", { exact: true }).check();
  const names = page.getByPlaceholder("مثل: لافندر");
  await names.nth(0).fill("تفاح");
  await names.nth(1).fill("خوخ");
  await page.getByLabel("السعر ₪").nth(0).fill("5");
  await page.getByLabel("السعر ₪").nth(1).fill("5");
  await page.getByText("صورة وحدة لكل الأنواع (اختياري)").click();
  await page.getByLabel("صور المنتج").setInputFiles(await photo("#cccccc"));
  await page.getByRole("button", { name: "حفظ ونشر في المتجر" }).click();
  await expect(page).toHaveURL(/\?saved=ok$/, { timeout: 60_000 });
  await expect(page.getByText("ظاهر في المتجر")).toBeVisible();
});

test("products list: quick edit changes a price in place, and the selection moves to another category", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await page.goto(`/admin/products?q=${encodeURIComponent(NAME)}`);
  const cards = page.locator(".admin-product-cards");
  const card = cards
    .locator(".admin-product-item")
    .filter({ hasText: "3 أنواع" });
  await card.getByRole("button", { name: /^تعديل سريع/ }).click();
  const form = card.locator("form.admin-quick-edit");
  await form.getByLabel("السعر ₪").first().fill("11");
  await form.getByRole("button", { name: "حفظ" }).click();
  await expect(form).toHaveCount(0, { timeout: 30_000 });
  const prices = await withTestDb(
    (sql) => sql<{ price: number }[]>`
      select v.price_agorot as price from product_variants v
      join products p on p.id = v.product_id
      where p.domain_id = ${domainId} and v.archived_at is null
      order by v.sort_order limit 1`,
  );
  expect(prices[0]!.price).toBe(1100);

  await cards.locator('input[type="checkbox"]').first().check();
  const select = page.locator("#bulk-move-category");
  await select.selectOption({ index: 2 });
  const target = await select.inputValue();
  await page.getByRole("button", { name: "نقل", exact: true }).click();
  await expect(page.getByText("تم نقل منتج واحد.")).toBeVisible({
    timeout: 30_000,
  });
  const moved = await withTestDb(
    (sql) => sql<{ total: number }[]>`
      select count(*)::int as total from products
      where name_ar like ${NAME + "%"} and category_id = ${target}`,
  );
  expect(moved[0]!.total).toBeGreaterThan(0);
});
