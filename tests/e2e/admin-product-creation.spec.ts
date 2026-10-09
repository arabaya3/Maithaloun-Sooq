import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import sharp from "sharp";

import {
  expectNoHorizontalOverflow,
  login,
  trackPageIssues,
  withTestDb,
} from "./support";

const SHOTS = "artifacts/admin-product-creation";
const WIDTHS = [
  [360, 800],
  [390, 844],
  [768, 1024],
  [1440, 900],
] as const;
const NAME = "منتج تجربة الإنشاء";
const SINGLE = `${NAME} المفرد`;

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

async function axe(page: Page, selector: string) {
  const result = await new AxeBuilder({ page })
    .include(selector)
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(
    result.violations.map((violation) => ({
      id: violation.id,
      nodes: violation.nodes.map((node) => node.target.join(" ")),
    })),
  ).toEqual([]);
}

async function photo(background: string) {
  return sharp({ create: { width: 600, height: 400, channels: 3, background } })
    .png()
    .toBuffer();
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

test("new product opens the wizard at 360, 390, 768 and 1440", async ({
  page,
}) => {
  const issues = trackPageIssues(page);
  await login(page);
  for (const [width, height] of WIDTHS) {
    await page.setViewportSize({ width, height });
    await page.goto("/admin/products/new");
    const steps = page.getByRole("list", { name: "خطوات إضافة المنتج" });
    await expect(steps.getByRole("listitem")).toHaveCount(5);
    await expect(steps.locator("[aria-current=step]")).toContainText(
      "المعلومات الأساسية",
    );
    const other = page.getByRole("navigation", { name: "طرق أخرى للبدء" });
    await expect(other.getByRole("link")).toHaveCount(2);
    await expectNoHorizontalOverflow(page);
    expect(
      await smallTargets(
        page,
        ".admin-wizard a, .admin-wizard button, .admin-wizard input, .admin-wizard select",
      ),
    ).toEqual([]);
    await axe(page, "main");
    await page.screenshot({
      path: `${SHOTS}/wizard-${width}.png`,
      fullPage: true,
    });
  }
  // The old manual route still works for bookmarks.
  await page.goto("/admin/products/new/manual");
  await expect(page).toHaveURL(/\/admin\/products\/new$/);
  expect(issues.consoleErrors).toEqual([]);
});

test("phone: wizard keeps typing through a refusal and a reload, then builds exact variants", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const issues = trackPageIssues(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await page.goto("/admin/products/new");
  await page.getByLabel("اسم المنتج بالعربية").fill(NAME);
  await page.getByLabel("القسم").selectOption({ index: 1 });
  await page.getByLabel("سعر البيع ₪").fill("عشرة دولار");
  await page.getByRole("button", { name: "التالي: الخيارات والمخزون" }).click();
  await expect(
    page.getByText("اكتبي سعر البيع بالشيكل، مثل 12 أو 12.50."),
  ).toBeVisible();
  await expect(page.getByLabel("سعر البيع ₪")).toBeFocused();
  await expect(page.getByLabel("اسم المنتج بالعربية")).toHaveValue(NAME);
  await page.screenshot({ path: `${SHOTS}/wizard-error-390.png` });

  // A reload never loses what was typed.
  await page.getByLabel("سعر البيع ₪").fill("6.00");
  await expect(page.getByText(/حُفظت المسودة على هذا الجهاز/)).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "استعادة المسودة" }).click();
  await expect(page.getByLabel("اسم المنتج بالعربية")).toHaveValue(NAME);
  await expect(page.getByLabel("سعر البيع ₪")).toHaveValue("6.00");

  await page.getByRole("button", { name: "التالي: الخيارات والمخزون" }).click();
  await expect(page).toHaveURL(
    /\/admin\/products\/new\?product=[a-z0-9-]+&step=2$/,
    {
      timeout: 15_000,
    },
  );
  domainId = /product=([a-z0-9-]+)/.exec(page.url())![1]!;
  await expect(page.getByText(/آخر حفظ/).first()).toBeVisible();

  await page.getByRole("radio", { name: "أكثر من نوع من الخيارات" }).check();
  await page.getByLabel("أضيفي قيمة لـ الرائحة").fill("لافندر، الورد الأبيض");
  await page.getByLabel("أضيفي قيمة لـ الرائحة").press("Enter");
  await page.getByLabel("أضيفي قيمة لـ الحجم").fill("750 مل، 1 لتر");
  await page.getByLabel("أضيفي قيمة لـ الحجم").press("Enter");
  const list = page.getByRole("group", { name: /الأصناف التي ستُنشأ/ });
  await expect(list.getByRole("checkbox")).toHaveCount(4);
  await list.getByRole("checkbox", { name: "لافندر – 1 لتر" }).uncheck();
  await expect(list).toContainText("(3 من 4)");
  await expectNoHorizontalOverflow(page);
  await page.screenshot({
    path: `${SHOTS}/wizard-options-390.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "التالي: الصور" }).click();
  await expect(page).toHaveURL(
    new RegExp(`/admin/products/${domainId}\\?guide=images#wizard-images$`),
    {
      timeout: 15_000,
    },
  );

  const variants = await withTestDb(
    (sql) => sql<{ label: string; is_default: boolean }[]>`
      select v.label_ar as label, v.is_default from product_variants v
      join products p on p.id = v.product_id
      where p.domain_id = ${domainId} and v.archived_at is null order by v.sort_order`,
  );
  expect(variants.map((row) => row.label).sort()).toEqual(
    ["الورد الأبيض · 1 لتر", "الورد الأبيض · 750 مل", "لافندر · 750 مل"].sort(),
  );
  expect(variants.filter((row) => row.is_default)).toHaveLength(1);

  // Steps 3–5 continue in the product's own workspace.
  const guide = page.getByRole("region", { name: "إكمال المنتج الجديد" });
  await expect(guide.locator("[aria-current=step]")).toContainText("الصور");
  await expect(
    page.getByRole("navigation", { name: "أقسام المنتج" }).getByRole("link"),
  ).toHaveText([
    "نظرة عامة",
    "الخيارات والأصناف",
    "الصور",
    "الأسعار وطرق البيع",
    "المخزون",
    "النشر",
    "السجل",
  ]);
  // Step 3: pictures are uploaded unassigned, then each is mapped on purpose.
  const mapping = page.getByRole("region", { name: "صور المنتج وربطها" });
  await mapping.getByLabel("اختيار من المعرض").setInputFiles([
    {
      name: "rose.png",
      mimeType: "image/png",
      buffer: await photo("#ff88bb"),
    },
  ]);
  await expect(mapping.getByRole("status")).toHaveText(
    "رُفعت الصور. اربطي كل صورة بما تُظهره.",
  );
  await mapping.getByLabel("هذه الصورة تُظهر").selectOption({
    label: "الورد الأبيض",
  });
  await expect(mapping.getByRole("status")).toHaveText("حُفظ ربط الصورة.");
  await mapping.getByRole("checkbox", { name: /الرائحة: لافندر/ }).check();
  await expect(mapping.getByRole("status")).toHaveText("حُفظ الاختيار.");
  await expectNoHorizontalOverflow(page);
  await axe(page, "#wizard-images");
  await page.screenshot({
    path: `${SHOTS}/wizard-images-390.png`,
    fullPage: true,
  });

  // Step 4: each variant keeps its own price and identifiers; opening stock is covered in zz-wizard-stock.
  await page.getByRole("link", { name: "التالي: الأسعار والمخزون" }).click();
  await expect(page).toHaveURL(/guide=prices#wizard-prices$/);
  const card = page.getByRole("form", { name: "لافندر · 750 مل" });
  await card.getByLabel("السعر (₪)").fill("7.50");
  await card.getByLabel("رمز SKU").fill("WIZ-LAV-750");
  await card.getByRole("button", { name: "حفظ الصنف" }).click();
  await expect(card.getByRole("status")).toHaveText("حُفظ هذا الصنف.");
  const prices = await withTestDb(
    (sql) => sql<{ label: string; price: number; sku: string | null }[]>`
      select v.label_ar as label, v.price_agorot as price, v.sku
      from product_variants v join products p on p.id = v.product_id
      where p.domain_id = ${domainId} and v.archived_at is null order by v.label_ar`,
  );
  expect(prices.map((row) => [row.label, row.price, row.sku])).toEqual([
    ["الورد الأبيض · 1 لتر", 600, null],
    ["الورد الأبيض · 750 مل", 600, null],
    ["لافندر · 750 مل", 750, "WIZ-LAV-750"],
  ]);
  await expectNoHorizontalOverflow(page);
  await axe(page, "#wizard-prices");
  await page.screenshot({
    path: `${SHOTS}/wizard-prices-390.png`,
    fullPage: true,
  });

  // Step 5: a readable summary, then the owner's choice; the server repeats every check.
  await page.getByRole("link", { name: "التالي: المراجعة" }).click();
  await expect(page).toHaveURL(/guide=review#wizard-review$/);
  const review = page.getByRole("region", { name: "مراجعة المنتج" });
  await expect(review.getByRole("table")).toContainText("لافندر · 750 مل");
  await expect(review.getByRole("table")).toContainText("7.50 ₪");
  await expect(
    review.getByRole("link", { name: "معاينة صفحة المنتج في المتجر" }),
  ).toBeVisible();
  await review.getByRole("radio", { name: /منشور ومتوفر/ }).check();
  await expect(review.getByRole("note")).toContainText("الصورة الرئيسية");
  await review
    .getByRole("checkbox", { name: "أقبل النشر بصورة مؤقتة إن لم توجد صورة" })
    .check();
  await review.getByRole("button", { name: "حفظ الحالة" }).click();
  await expect(review.getByRole("status")).toHaveText("حُفظت حالة المنتج.");
  await expect(page.getByRole("region", { name: "السجل" })).toContainText(
    "إنشاء الخيارات والأصناف",
  );
  await expectNoHorizontalOverflow(page);
  await axe(page, "#wizard-review");
  await page.screenshot({
    path: `${SHOTS}/wizard-review-390.png`,
    fullPage: true,
  });

  // Coming back to step 2 shows what was created instead of building it twice.
  await page.goto(`/admin/products/new?product=${domainId}&step=2`);
  await expect(page.getByText("للمنتج 3 صنف", { exact: false })).toBeVisible();
  await page.goto("/admin/products/new");
  await expect(page.getByText(/لديك مسودة محفوظة/)).toHaveCount(0);
  expect(issues.consoleErrors).toEqual([]);
  expect(issues.failedRequests).toEqual([]);
});

test("phone storefront: sold-out values close, moves are explained, a removed variant stays in the cart", async ({
  page,
}) => {
  const issues = trackPageIssues(page);
  await page.setViewportSize({ width: 390, height: 844 });
  const [{ slug }] = await withTestDb(
    (sql) => sql<{ slug: string }[]>`
      select slug from products where domain_id = ${domainId}`,
  );
  const setAvailability = (label: string, availability: string) =>
    withTestDb(
      (sql) => sql`
        update product_variants v set availability = ${availability}
        from products p where p.id = v.product_id
        and p.domain_id = ${domainId} and v.label_ar = ${label}`,
    );
  for (const label of ["لافندر · 750 مل", "الورد الأبيض · 1 لتر"])
    await setAvailability(label, "available");
  await setAvailability("الورد الأبيض · 750 مل", "unavailable");

  await page.goto(`/products/${slug}`);
  const scent = page.getByRole("radiogroup", { name: "الرائحة" });
  const size = page.getByRole("radiogroup", { name: "الحجم" });
  await expect(scent.getByRole("radio", { name: "لافندر" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  // Lavender has no 1 litre, so choosing it moves to the white rose and says so.
  await size.getByRole("radio", { name: "1 لتر" }).click();
  await expect(page.locator(".variant-adjusted-note")).toHaveText(
    "غيّرنا الرائحة: الورد الأبيض لأن الاختيار السابق غير متوفر مع هذا الخيار.",
  );
  await expect(
    scent.getByRole("radio", { name: "الورد الأبيض" }),
  ).toHaveAttribute("aria-checked", "true");
  await page
    .locator(".product-detail-actions")
    .getByRole("button", { name: "أضف إلى السلة" })
    .click();
  await page.screenshot({
    path: `${SHOTS}/store-adjusted-390.png`,
    fullPage: true,
  });

  // With every white rose sold out, the value is closed and labelled.
  await setAvailability("الورد الأبيض · 1 لتر", "unavailable");
  await page.goto(`/products/${slug}`);
  const rose = scent.getByRole("radio", { name: /الورد الأبيض/ });
  await expect(rose).toBeDisabled();
  await expect(rose).toContainText("غير متوفر");
  await expect(page.locator(".availability-status")).toHaveText(
    "متاح للإضافة إلى السلة",
  );

  // The variant in the cart is removed: the line stays, explains itself and blocks checkout.
  await withTestDb(
    (sql) => sql`
      update product_variants v set archived_at = now()
      from products p where p.id = v.product_id
      and p.domain_id = ${domainId} and v.label_ar = 'الورد الأبيض · 1 لتر'`,
  );
  await page.goto("/cart");
  const removed = page.locator(".cart-line-removed");
  await expect(removed).toContainText(NAME);
  await expect(removed).toContainText("لم يعد يُباع");
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: `${SHOTS}/cart-removed-390.png` });
  await removed.getByRole("button", { name: "حذف من السلة" }).click();
  await expect(page.getByRole("heading", { name: "سلتك فارغة" })).toBeVisible();
  expect(issues.consoleErrors).toEqual([]);
});

test("phone: publishing follows the server rules; archive and permanent delete are explicit", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  // Publishing rules are checked on a one-variant product of its own, made through the wizard.
  await page.goto("/admin/products/new");
  await page.getByLabel("اسم المنتج بالعربية").fill(SINGLE);
  await page.getByLabel("القسم").selectOption({ index: 1 });
  await page.getByLabel("سعر البيع ₪").fill("6.00");
  await page.getByRole("button", { name: "التالي: الخيارات والمخزون" }).click();
  await expect(page).toHaveURL(/step=2$/, { timeout: 15_000 });
  domainId = /product=([a-z0-9-]+)/.exec(page.url())![1]!;
  await page.goto(`/admin/products/${domainId}#publication`);
  const publication = page.getByRole("region", { name: "حالة النشر" });

  // Without accepting the temporary picture the server refuses, and nothing changes.
  await publication
    .locator('select[name="publication"]')
    .selectOption("published");
  await publication.getByRole("button", { name: "حفظ حالة النشر" }).click();
  await expect(
    publication.getByText(
      "المنتج بدون صورة حقيقية. فعّلي «النشر بصورة مؤقتة» أو أضيفي صورة أولاً.",
    ),
  ).toBeVisible();
  const [still] = await withTestDb(
    (sql) => sql<{ publication: string }[]>`
      select publication from products where domain_id = ${domainId}`,
  );
  expect(still!.publication).toBe("draft");

  await publication
    .locator('select[name="publication"]')
    .selectOption("published");
  await publication.getByLabel(/النشر بصورة مؤقتة/).check();
  await publication.getByRole("button", { name: "حفظ حالة النشر" }).click();
  await expect(page.getByText("تم تحديث حالة النشر.")).toBeVisible();
  await expect(
    page.getByRole("region", { name: "جاهزية المنتج" }),
  ).toContainText("منشور ويظهر للزبائن.");

  // Archive needs a reason and keeps the product restorable.
  const danger = page.getByRole("region", { name: "منطقة الخطر" });
  await danger.getByLabel("سبب الأرشفة").fill("تجربة الأرشفة");
  await danger.getByRole("button", { name: /أرشفة المنتج/ }).click();
  await expect(page.getByText(/تمت أرشفة المنتج/)).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/danger-390.png`, fullPage: true });

  // Nothing references this product, so permanent delete is offered behind the exact name.
  const remove = page
    .getByRole("region", { name: "منطقة الخطر" })
    .getByRole("button", { name: /حذف نهائي/ });
  await expect(remove).toBeDisabled();
  const confirm = page.getByLabel(/للتأكيد اكتبي اسم المنتج/);
  await confirm.fill("منتج تجربة");
  await expect(remove).toBeDisabled();
  await confirm.fill(SINGLE);
  await remove.click();
  await expect(page).toHaveURL(/\/admin\/products\?deleted=/);
  await expect(page.getByText(`تم حذف «${SINGLE}» نهائياً.`)).toBeVisible();
  const rows = await withTestDb(
    (sql) => sql`select 1 from products where domain_id = ${domainId}`,
  );
  expect(rows).toHaveLength(0);
});
