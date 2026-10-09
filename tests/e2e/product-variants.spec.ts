import { expect, test, type Page } from "@playwright/test";
import sharp from "sharp";

import {
  expectNoHorizontalOverflow,
  login,
  trackPageIssues,
  withTestDb,
} from "./support";

// Storefront fixture: scent × size with one combination that does not exist (مسك 1 لتر).
const STORE = {
  domainId: "e2e-lamis",
  slug: "e2e-lamis",
  name: "معطر لميس تجريبي",
};
const MANUAL = {
  domainId: "e2e-lilac",
  slug: "e2e-lilac",
  name: "معطر ليلك تجريبي",
};
const ASSISTANT_NAME = "معطر لميس المساعد";

test.describe.configure({ mode: "serial" });

async function cleanUp() {
  await withTestDb(async (sql) => {
    const names = [STORE.name, MANUAL.name, ASSISTANT_NAME];
    // Orders are permanent, so a fixture that was ordered is archived under a fresh identity instead of deleted.
    const suffix = `-old-${Date.now()}`;
    await sql`
      update product_variants v set domain_id = v.domain_id || ${suffix}
      from products p where p.id = v.product_id and p.name_ar in ${sql(names)}
        and exists (select 1 from order_items i where i.product_domain_id = p.domain_id)`;
    await sql`
      update products p set domain_id = p.domain_id || ${suffix}, slug = p.slug || ${suffix},
        name_ar = p.name_ar || ' (قديم)', publication = 'draft', archived_at = now()
      where p.name_ar in ${sql(names)}
        and exists (select 1 from order_items i where i.product_domain_id = p.domain_id)`;
    // None of these fixtures records stock, so the rest delete cleanly.
    await sql`delete from products where name_ar in ${sql(names)}`;
  });
}

async function seedStorefront() {
  await withTestDb(async (sql) => {
    const [product] = await sql<{ id: string }[]>`
      insert into products (domain_id, slug, name_ar, price_agorot, sort_order, category_id, availability,
        publication, image_kind, image_src, image_alt, image_width, image_height, details_status)
      values (${STORE.domainId}, ${STORE.slug}, ${STORE.name}, 1000, 900, 'home', 'available',
        'published', 'image', '/products/lamis-air-group.webp', 'معطر لميس', 800, 800, 'placeholder')
      returning id`;
    let order = 0;
    const variant = async (
      key: string,
      label: string,
      price: number,
      isDefault: boolean,
      attributes: Record<string, string>,
    ) => {
      const [row] = await sql<{ id: string }[]>`
        insert into product_variants (product_id, domain_id, label_ar, attributes, price_agorot, availability,
          image_kind, image_src, image_alt, image_width, image_height, sort_order, is_default)
        values (${product!.id}, ${`${STORE.domainId}--${key}`}, ${label}, ${sql.json(attributes)}, ${price},
          'available', 'image', '/products/lamis-air-group.webp', 'معطر لميس', 800, 800, ${order++}, ${isDefault})
        returning id`;
      return row!.id;
    };
    const lavenderSmall = await variant(
      "lav-450",
      "لافندر · 450 مل",
      1000,
      true,
      { الرائحة: "لافندر", الحجم: "450 مل" },
    );
    const muskSmall = await variant("musk-450", "مسك · 450 مل", 1200, false, {
      الرائحة: "مسك",
      الحجم: "450 مل",
    });
    const lavenderLarge = await variant(
      "lav-1l",
      "لافندر · 1 لتر",
      1800,
      false,
      { الرائحة: "لافندر", الحجم: "1 لتر" },
    );
    const option = async (name: string, kind: string, order: number) => {
      const [row] = await sql<{ id: string }[]>`
        insert into product_options (product_id, name_ar, normalized_name, kind, sort_order)
        values (${product!.id}, ${name}, ${name}, ${kind}, ${order}) returning id`;
      return row!.id;
    };
    const value = async (optionId: string, text: string, order: number) => {
      const [row] = await sql<{ id: string }[]>`
        insert into product_option_values (option_id, product_id, value_ar, normalized_value, sort_order)
        values (${optionId}, ${product!.id}, ${text}, ${text}, ${order}) returning id`;
      return row!.id;
    };
    const scent = await option("الرائحة", "fragrance", 0);
    const size = await option("الحجم", "size", 1);
    const lavender = await value(scent, "لافندر", 0);
    const musk = await value(scent, "مسك", 1);
    const small = await value(size, "450 مل", 0);
    const large = await value(size, "1 لتر", 1);
    const link = async (
      variantId: string,
      scentValue: string,
      sizeValue: string,
    ) => {
      await sql`
        insert into product_variant_option_values (variant_id, product_id, option_id, value_id)
        values (${variantId}, ${product!.id}, ${scent}, ${scentValue}),
               (${variantId}, ${product!.id}, ${size}, ${sizeValue})`;
      const key = [
        [scent, scentValue],
        [size, sizeValue],
      ]
        .sort(([left], [right]) => left!.localeCompare(right!))
        .map(([optionId, valueId]) => `${optionId}=${valueId}`)
        .join("|");
      await sql`update product_variants set combination_key = ${key} where id = ${variantId}`;
    };
    await link(lavenderSmall, lavender, small);
    await link(muskSmall, musk, small);
    await link(lavenderLarge, lavender, large);
    await sql`
      insert into product_images (product_id, scope, variant_id, src, alt_ar, width, height, sort_order, is_primary)
      values (${product!.id}, 'product', null, '/products/lamis-air-group.webp', 'مجموعة معطرات لميس', 800, 800, 0, true),
             (${product!.id}, 'product', null, '/products/lamis-lavender-real.webp', 'معطر لميس لافندر', 800, 800, 1, false),
             (${product!.id}, 'variant', ${muskSmall}, '/products/lamis-velvet-musk-real.webp', 'معطر لميس مسك', 800, 800, 2, false)`;
  });
}

async function photo(background: string) {
  return sharp({ create: { width: 500, height: 500, channels: 3, background } })
    .png()
    .toBuffer();
}

test.beforeAll(async () => {
  await cleanUp();
  await seedStorefront();
});
test.afterAll(cleanUp);

test("storefront: choose scent and size, missing combination never reached, exact variant reaches the order", async ({
  page,
}) => {
  const issues = trackPageIssues(page);
  await page.goto(`/products/${STORE.slug}`);
  const scent = page.getByRole("radiogroup", { name: "الرائحة" });
  const size = page.getByRole("radiogroup", { name: "الحجم" });
  await expect(scent.getByRole("radio", { name: "لافندر" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await expect(page.locator(".product-detail-price")).toContainText("10");

  // مسك comes only in 450 مل: with 1 لتر chosen it stays reachable but marked, and choosing it moves the size.
  await size.getByRole("radio", { name: "1 لتر" }).click();
  await expect(page.locator(".product-detail-price")).toContainText("18");
  await expect(scent.getByRole("radio", { name: /^مسك/ })).toHaveAttribute(
    "data-state",
    "adjusts",
  );
  await scent.getByRole("radio", { name: /^مسك/ }).click();
  await expect(size.getByRole("radio", { name: "450 مل" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await scent.getByRole("radio", { name: "لافندر" }).click();
  await size.getByRole("radio", { name: "1 لتر" }).click();

  // Choosing values never asks the server; the page already holds every combination.
  const requests: string[] = [];
  page.on("request", (request) => {
    if (request.resourceType() === "fetch") requests.push(request.url());
  });
  await size.getByRole("radio", { name: "450 مل" }).click();
  await scent.getByRole("radio", { name: /^مسك/ }).click();
  expect(requests).toEqual([]);
  await expect(page.locator(".product-detail-price")).toContainText("12");
  await expect(page).toHaveURL(/variant=e2e-lamis--musk-450/);

  // The musk variant's own image is the one shown.
  const gallery = page.getByRole("region", { name: `صور ${STORE.name}` });
  await expect(
    gallery.getByRole("img", { name: /^معطر لميس مسك/ }),
  ).toBeVisible();
  await expect(gallery.getByRole("button", { name: /عرض الصورة/ })).toHaveCount(
    3,
  );

  await page
    .locator(".product-detail-actions")
    .getByRole("button", { name: "أضف إلى السلة" })
    .click();
  await expect(page.locator(".cart-button")).toHaveAccessibleName(
    "السلة، عدد المنتجات 1",
  );
  await page.locator(".cart-button").click();
  await expect(page.getByLabel("مجموع المنتجات 12 ₪")).toBeVisible();

  // The price is re-read at checkout; a price raised after adding to the cart is the one charged.
  await withTestDb(
    (sql) =>
      sql`update product_variants set price_agorot = 1300 where domain_id = 'e2e-lamis--musk-450'`,
  );
  await page.getByRole("link", { name: "متابعة إلى بيانات الطلب" }).click();
  await page.getByRole("textbox", { name: "الاسم الكامل" }).fill("عميل تجريبي");
  await page.getByLabel("مفتاح الدولة").selectOption("970");
  await page.getByRole("textbox", { name: "الرقم المحلي" }).fill("0591234567");
  await page
    .getByRole("textbox", { name: "العنوان بالتفصيل أو أقرب نقطة دالة" })
    .fill("عنوان محلي مفصل للاختبار");
  await page.getByRole("button", { name: "تأكيد الطلب" }).click();
  await expect(page).toHaveURL(/\/orders\/MS-[A-Za-z0-9_-]{24}\/confirmation$/);
  const [line] = await withTestDb(
    (sql) => sql<
      { domain_id: string; unit: number; snapshot: Record<string, string> }[]
    >`
      select i.variant_domain_id as domain_id, i.unit_price_agorot as unit, i.variant_attributes_snapshot as snapshot
      from order_items i where i.product_domain_id = ${STORE.domainId}`,
  );
  expect(line).toEqual({
    domain_id: "e2e-lamis--musk-450",
    unit: 1300,
    snapshot: { الرائحة: "مسك", الحجم: "450 مل" },
  });
  expect(issues.consoleErrors).toEqual([]);
  expect(issues.failedRequests).toEqual([]);
});

test("storefront gallery: swipe, arrows, thumbnails and RTL keyboard", async ({
  page,
}) => {
  const issues = trackPageIssues(page);
  await page.goto(`/products/${STORE.slug}?variant=e2e-lamis--musk-450`);
  const gallery = page.getByRole("region", { name: `صور ${STORE.name}` });
  const thumb = (n: number) =>
    gallery.getByRole("button", { name: new RegExp(`^عرض الصورة ${n} من 3`) });
  // The musk variant's own picture is active; shared ones stay one tap away.
  await expect(thumb(3)).toHaveAttribute("aria-current", "true");

  await thumb(3).focus();
  await page.keyboard.press("Home");
  await expect(thumb(1)).toHaveAttribute("aria-current", "true");
  await expect(thumb(1)).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(thumb(2)).toHaveAttribute("aria-current", "true");
  await page.keyboard.press("End");
  await expect(thumb(3)).toHaveAttribute("aria-current", "true");
  await expect(
    gallery.getByRole("button", { name: "الصورة التالية" }),
  ).toBeDisabled();
  await page.keyboard.press("ArrowRight");
  await expect(thumb(2)).toHaveAttribute("aria-current", "true");

  // A sideways swipe on the main image moves one picture; in RTL a swipe to the right goes forward.
  const stage = gallery.locator(".product-gallery-stage");
  const box = (await stage.boundingBox())!;
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width * 0.3, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.7, y, { steps: 5 });
  await page.mouse.up();
  await expect(thumb(3)).toHaveAttribute("aria-current", "true");
  await gallery.getByRole("button", { name: "الصورة السابقة" }).click();
  await expect(thumb(2)).toHaveAttribute("aria-current", "true");

  for (const target of await gallery.getByRole("button").all()) {
    const size = await target.boundingBox();
    expect(size!.height).toBeGreaterThanOrEqual(44);
    expect(size!.width).toBeGreaterThanOrEqual(44);
  }
  for (const radio of await page.getByRole("radio").all()) {
    expect((await radio.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
  expect(issues.consoleErrors).toEqual([]);
  expect(issues.failedRequests).toEqual([]);
});

test("storefront variant page fits 360, 390, 768 and 1440 without errors", async ({
  page,
}) => {
  const issues = trackPageIssues(page);
  for (const width of [360, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/products/${STORE.slug}?variant=e2e-lamis--musk-450`);
    await expect(page.getByRole("radiogroup", { name: "الحجم" })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await page.screenshot({
      path: `artifacts/store-ops/variant-product-${width}.png`,
      fullPage: true,
    });
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`/products/${STORE.slug}`);
  const animation = await page
    .locator(".product-gallery-image")
    .evaluate((element) => getComputedStyle(element).animationName);
  expect(animation).toBe("none");
  expect(issues.consoleErrors).toEqual([]);
  expect(issues.failedRequests).toEqual([]);
});

test("admin at 390: three scents with three images, by hand", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const issues = trackPageIssues(page);
  await withTestDb(async (sql) => {
    const [product] = await sql<{ id: string }[]>`
      insert into products (domain_id, slug, name_ar, price_agorot, sort_order, category_id, availability,
        publication, image_kind, placeholder_variant, details_status)
      values (${MANUAL.domainId}, ${MANUAL.slug}, ${MANUAL.name}, 900, 901, 'home', 'available',
        'published', 'placeholder', 'general-cleaner', 'placeholder')
      returning id`;
    await sql`
      insert into product_variants (product_id, domain_id, label_ar, attributes, price_agorot, availability,
        image_kind, placeholder_variant, sort_order, is_default)
      values (${product!.id}, ${`${MANUAL.domainId}--default`}, 'الأساسي', '{}', 900, 'available',
        'placeholder', 'general-cleaner', 0, true)`;
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await page.goto(`/admin/products/${MANUAL.domainId}?advanced=1`);
  const editor = page.getByRole("region", { name: "الصور والخيارات والأصناف" });
  const status = editor.getByRole("status");

  // Options stay folded until the product has some.
  await editor.getByText("الخيارات (0)").click();
  await editor.getByLabel("اسم الخيار").fill("الرائحة");
  await editor.getByLabel("القيم، مفصولة بفاصلة").fill("لافندر، ورد أبيض، مسك");
  await editor.getByRole("button", { name: "إضافة خيار" }).click();
  await expect(status).toHaveText("تمت إضافة الخيار.");
  await expect(editor.getByText("أصناف ينقصها اختيار: 1")).toBeVisible();

  const card = editor.locator(".admin-variant-card").first();
  await card.getByLabel("الرائحة").selectOption({ label: "لافندر" });
  await card.getByRole("button", { name: "حفظ الصنف" }).click();
  await expect(status).toHaveText("تم حفظ اختيارات الصنف.");
  await expect(editor.getByText("تركيبات غير موجودة (2)")).toBeVisible();
  await editor.getByLabel("سعر الأصناف الجديدة").fill("10 شيكل");
  await editor.getByRole("button", { name: "إنشاء الأصناف الناقصة" }).click();
  await expect(status).toHaveText("تمت إضافة الأصناف الناقصة.");
  await expect(editor.getByText("كل التركيبات موجودة.")).toBeVisible();

  await editor.getByLabel("إضافة صور (JPEG أو PNG أو WebP)").setInputFiles([
    {
      name: "lavender.png",
      mimeType: "image/png",
      buffer: await photo("#7a5ab0"),
    },
    { name: "rose.png", mimeType: "image/png", buffer: await photo("#ffffff") },
    { name: "musk.png", mimeType: "image/png", buffer: await photo("#8a6a3a") },
  ]);
  await editor.getByRole("button", { name: "رفع الصور" }).click();
  await expect(editor.getByText("الصور (3 من 8)")).toBeVisible();
  const items = editor.locator(".admin-gallery-item");
  for (const [index, label] of ["لافندر", "ورد أبيض", "مسك"].entries()) {
    await items
      .nth(index)
      .getByLabel("الصورة تخص")
      .selectOption({ label: `الرائحة: ${label}` });
    await expect(status).toHaveText("تم ربط الصورة.");
  }
  await expectNoHorizontalOverflow(page);
  await page.screenshot({
    path: "artifacts/store-ops/admin-media-editor-390.png",
    fullPage: true,
  });

  const rows = await withTestDb(
    (sql) => sql<{ label: string; price: number; images: number }[]>`
      select v.label_ar as label, v.price_agorot as price,
        (select count(*)::int from product_images i
          join product_variant_option_values l on l.value_id = i.option_value_id
          where l.variant_id = v.id and i.archived_at is null) as images
      from product_variants v join products p on p.id = v.product_id
      where p.domain_id = ${MANUAL.domainId} and v.archived_at is null order by v.sort_order`,
  );
  expect(rows).toEqual([
    { label: "لافندر", price: 900, images: 1 },
    { label: "ورد أبيض", price: 1000, images: 1 },
    { label: "مسك", price: 1000, images: 1 },
  ]);

  await page.setViewportSize({ width: 360, height: 800 });
  await page.reload();
  await expectNoHorizontalOverflow(page);
  expect(issues.consoleErrors).toEqual([]);
  expect(issues.failedRequests).toEqual([]);
});

async function ask(page: Page, text: string) {
  const panel = page.getByRole("dialog", { name: "المساعد" });
  await panel.getByLabel("رسالتك للمساعد").fill(text);
  await panel.getByRole("button", { name: "إرسال" }).click();
}

test("assistant: three photos and three scents over several messages, one card creates everything once", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const issues = trackPageIssues(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await page.getByRole("button", { name: "فتح المساعد" }).click();
  const panel = page.getByRole("dialog", { name: "المساعد" });

  await panel.getByLabel("اختيار مرفقات").setInputFiles([
    {
      name: "lavender.png",
      mimeType: "image/png",
      buffer: await photo("#7a5ab0"),
    },
    { name: "rose.png", mimeType: "image/png", buffer: await photo("#ffffff") },
    { name: "musk.png", mimeType: "image/png", buffer: await photo("#8a6a3a") },
  ]);
  await expect(
    panel.getByRole("list", { name: "المرفقات" }).getByLabel("جارٍ الرفع"),
  ).toHaveCount(0);
  await ask(page, "اقرئي صور المنتج");
  const draft = panel.getByRole("region", { name: "مسودة المنتج" });
  await expect(draft.last()).toBeVisible();

  await ask(page, `الاسم ${ASSISTANT_NAME}`);
  await expect(draft.last()).toContainText(ASSISTANT_NAME);
  await ask(page, "خليه منشور");
  await ask(page, "القسم مستلزمات منزلية");
  await ask(page, "الروائح لافندر وورد أبيض ومسك، كلهم 450 مل والسعر 10 شيكل");
  // The brown photo is not readable with confidence, so the assistant asks instead of guessing.
  await expect(
    panel.getByText("ما قدرت أتأكد من الصورة 3 (يمكن مسك). لأي الرائحة هي؟"),
  ).toBeVisible();
  await expect(draft.last()).toContainText("لافندر");
  await expect(draft.last()).toContainText("ورد أبيض");
  expect(await created()).toEqual([]);

  // Reloading in the middle keeps the server-side draft.
  await page.reload();
  await page.getByRole("button", { name: "فتح المساعد" }).click();
  await ask(page, "هاي الصورة للمسك");
  const card = panel.getByRole("region", {
    name: `إضافة منتج بأصناف: ${ASSISTANT_NAME}`,
  });
  await expect(card).toContainText("بانتظار تأكيدك");
  await expect(card).toContainText("مسك");
  expect(await created()).toEqual([]);

  // Typing «نعم» never confirms.
  await ask(page, "نعم");
  await expect(card).toContainText("بانتظار تأكيدك");
  expect(await created()).toEqual([]);

  await card.getByRole("button", { name: "تأكيد الإضافة" }).dblclick();
  await expect(card.getByRole("status")).toContainText(
    `تمت إضافة ${ASSISTANT_NAME}`,
  );
  const rows = await created();
  expect(rows).toHaveLength(3);
  expect(rows.map((row) => [row.label, row.price, row.images])).toEqual([
    ["لافندر", 1000, 1],
    ["ورد أبيض", 1000, 1],
    ["مسك", 1000, 1],
  ]);
  expect(new Set(rows.map((row) => row.product)).size).toBe(1);
  await expectNoHorizontalOverflow(page);
  expect(issues.consoleErrors).toEqual([]);
  expect(issues.failedRequests).toEqual([]);
});

async function created() {
  return withTestDb(
    (sql) => sql<
      { product: string; label: string; price: number; images: number }[]
    >`
      select p.domain_id as product, v.label_ar as label, v.price_agorot as price,
        (select count(*)::int from product_images i where i.variant_id = v.id) as images
      from product_variants v join products p on p.id = v.product_id
      where p.name_ar = ${ASSISTANT_NAME} order by v.sort_order`,
  );
}
