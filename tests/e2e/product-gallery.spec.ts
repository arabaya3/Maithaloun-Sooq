import { expect, test, type Page } from "@playwright/test";
import sharp from "sharp";

import {
  expectNoHorizontalOverflow,
  login,
  trackPageIssues,
  withTestDb,
} from "./support";

// معطر لويال shape: colour × size, six variants, images of every scope. Green has no picture of its own.
const LOYAL = {
  domainId: "e2e-loyal",
  slug: "e2e-loyal",
  name: "معطر لويال تجريبي",
};
const DRAFT = {
  domainId: "e2e-loyal-draft",
  slug: "e2e-loyal-draft",
  name: "معطر لويال مسودة",
};
const PRICES = {
  "blue-s": 1000,
  "blue-l": 1800,
  "pink-s": 1100,
  "pink-l": 1900,
  "green-s": 1200,
  "green-l": 2000,
} as const;
type Key = keyof typeof PRICES;

test.describe.configure({ mode: "serial" });

async function cleanUp() {
  await withTestDb(async (sql) => {
    const names = [LOYAL.name, DRAFT.name];
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
    await sql`delete from product_images where product_id in (select id from products where name_ar in ${sql(names)})`;
    await sql`delete from products where name_ar in ${sql(names)}`;
  });
}

async function seed(
  product: typeof LOYAL,
  publication: "published" | "draft",
  withImages: boolean,
) {
  return withTestDb(async (sql) => {
    const [row] = await sql<{ id: string }[]>`
      insert into products (domain_id, slug, name_ar, price_agorot, sort_order, category_id, availability,
        publication, image_kind, image_src, image_alt, image_width, image_height, details_status)
      values (${product.domainId}, ${product.slug}, ${product.name}, 1100, 905, 'home', 'available',
        ${publication}, 'image', '/products/loyal-air-fresheners.png', ${product.name}, 800, 800, 'placeholder')
      returning id`;
    const productId = row!.id;
    const option = async (name: string, kind: string, order: number) => {
      const [created] = await sql<{ id: string }[]>`
        insert into product_options (product_id, name_ar, normalized_name, kind, sort_order)
        values (${productId}, ${name}, ${name}, ${kind}, ${order}) returning id`;
      return created!.id;
    };
    const value = async (optionId: string, text: string, order: number) => {
      const [created] = await sql<{ id: string }[]>`
        insert into product_option_values (option_id, product_id, value_ar, normalized_value, sort_order)
        values (${optionId}, ${productId}, ${text}, ${text}, ${order}) returning id`;
      return created!.id;
    };
    const color = await option("اللون", "color", 0);
    const size = await option("الحجم", "size", 1);
    const values = {
      blue: await value(color, "أزرق", 0),
      pink: await value(color, "زهري", 1),
      green: await value(color, "أخضر", 2),
      s: await value(size, "صغير", 0),
      l: await value(size, "كبير", 1),
    };
    const colorName = { blue: "أزرق", pink: "زهري", green: "أخضر" };
    const variants: Record<string, string> = {};
    let order = 0;
    for (const key of Object.keys(PRICES) as Key[]) {
      const [c, s] = key.split("-") as ["blue" | "pink" | "green", "s" | "l"];
      const label = `${colorName[c]} · ${s === "s" ? "صغير" : "كبير"}`;
      const [variant] = await sql<{ id: string }[]>`
        insert into product_variants (product_id, domain_id, label_ar, attributes, price_agorot, availability,
          image_kind, image_src, image_alt, image_width, image_height, sort_order, is_default, sku)
        values (${productId}, ${`${product.domainId}--${key}`}, ${label},
          ${sql.json({ اللون: colorName[c], الحجم: s === "s" ? "صغير" : "كبير" })}, ${PRICES[key]},
          'available', 'image', '/products/loyal-air-fresheners.png', ${product.name}, 800, 800, ${order++},
          ${key === "pink-s"}, ${`E2E-${product.domainId}-${key}`.toUpperCase()})
        returning id`;
      variants[key] = variant!.id;
      const key2 = [
        [color, values[c]],
        [size, values[s]],
      ]
        .sort(([left], [right]) => left!.localeCompare(right!))
        .map(([optionId, valueId]) => `${optionId}=${valueId}`)
        .join("|");
      await sql`
        insert into product_variant_option_values (variant_id, product_id, option_id, value_id)
        values (${variant!.id}, ${productId}, ${color}, ${values[c]}), (${variant!.id}, ${productId}, ${size}, ${values[s]})`;
      await sql`update product_variants set combination_key = ${key2} where id = ${variant!.id}`;
    }
    if (withImages) {
      await sql`update product_option_values set uses_shared_image = true where id = ${values.green}`;
      await sql`
        insert into product_images (product_id, scope, variant_id, option_id, option_value_id, src, alt_ar, width, height, sort_order, is_primary)
        values
          (${productId}, 'product', null, null, null, '/products/loyal-air-fresheners.png', ${product.name}, 800, 800, 0, true),
          (${productId}, 'option_value', null, ${color}, ${values.blue}, '/products/lilac-air-blue-real.webp', ${product.name}, 800, 800, 1, false),
          (${productId}, 'option_value', null, ${color}, ${values.pink}, '/products/loyal-soft-pink-clean.webp', ${product.name}, 800, 800, 2, false),
          (${productId}, 'variant', ${variants["pink-l"]!}, null, null, '/products/lamis-freshener-real.png', ${product.name}, 800, 800, 3, false),
          (${productId}, 'variant', ${variants["blue-l"]!}, null, null, '/products/lilac-air-navy-real.webp', ${product.name}, 800, 800, 4, false),
          (${productId}, 'product', null, null, null, '/products/lilac-air-group.webp', ${product.name}, 800, 800, 5, false)`;
    }
    return { productId, values, variants };
  });
}

async function photo(background: string) {
  return sharp({ create: { width: 600, height: 400, channels: 3, background } })
    .png()
    .toBuffer();
}

const shownImage = (page: Page) =>
  page.locator(".product-gallery-image").getAttribute("src");
const radio = (page: Page, group: string, name: string) =>
  page
    .getByRole("radiogroup", { name: group })
    .getByRole("radio", { name: new RegExp(`^${name}`) });

test.beforeAll(async () => {
  await cleanUp();
  await seed(LOYAL, "published", true);
});
test.afterAll(cleanUp);

test("mobile: tapping the blue image selects only blue, keeps the size, and the cart gets that exact variant", async ({
  page,
}) => {
  const issues = trackPageIssues(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/products/${LOYAL.slug}`);
  await expect(radio(page, "اللون", "زهري")).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await radio(page, "الحجم", "كبير").click();
  await expect(page.locator(".product-detail-price")).toContainText("19");

  const gallery = page.getByRole("region", { name: `صور ${LOYAL.name}` });
  await gallery.getByRole("button", { name: /— اللون: أزرق$/ }).click();
  await expect(radio(page, "اللون", "أزرق")).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await expect(radio(page, "اللون", "زهري")).toHaveAttribute(
    "aria-checked",
    "false",
  );
  await expect(radio(page, "الحجم", "كبير")).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await expect(page.locator(".product-detail-price")).toContainText("18");
  await expect(page.locator(".availability-status")).toHaveText(
    "متاح للإضافة إلى السلة",
  );
  await expect(page).toHaveURL(/variant=e2e-loyal--blue-l/);

  await page
    .locator(".product-detail-actions")
    .getByRole("button", { name: "أضف إلى السلة" })
    .click();
  const saved = await page.evaluate(() =>
    window.localStorage.getItem("souq-maythalun:cart:v3"),
  );
  // The exact variant on screen, bought one piece at a time.
  expect(JSON.parse(saved!).lines).toEqual([
    {
      productId: LOYAL.domainId,
      variantId: "e2e-loyal--blue-l",
      sellingUnitId: expect.any(String),
      unitsPerSale: 1,
      quantity: 1,
    },
  ]);
  const [variant] = await withTestDb(
    (sql) => sql<{ sku: string; price: number }[]>`
      select sku, price_agorot as price from product_variants where domain_id = 'e2e-loyal--blue-l'`,
  );
  expect(variant).toEqual({ sku: "E2E-E2E-LOYAL-BLUE-L", price: 1800 });
  await page.locator(".cart-button").click();
  await expect(page.locator(".cart-line-variant").first()).toContainText(
    "أزرق · كبير",
  );
  await expect(page.getByLabel("مجموع المنتجات 18 ₪")).toBeVisible();
  expect(issues.consoleErrors).toEqual([]);
  expect(issues.failedRequests).toEqual([]);
});

test("options move the image: pink shows its picture, pink large its own, green falls back to the shared one", async ({
  page,
}) => {
  const issues = trackPageIssues(page);
  await page.goto(`/products/${LOYAL.slug}?variant=e2e-loyal--blue-s`);
  expect(await shownImage(page)).toContain("lilac-air-blue-real");
  await radio(page, "اللون", "زهري").click();
  expect(await shownImage(page)).toContain("loyal-soft-pink-clean");
  await radio(page, "الحجم", "كبير").click();
  expect(await shownImage(page)).toContain("lamis-freshener-real");
  await radio(page, "اللون", "أخضر").click();
  expect(await shownImage(page)).toContain("loyal-air-fresheners");
  await expect(page.locator(".product-detail-price")).toContainText("20");

  // Selecting values never asks the server, and only small thumbnails plus the shown picture are fetched.
  const widths = await page
    .locator(".product-gallery-thumbs img")
    .evaluateAll((images) =>
      images.flatMap((image) =>
        [...(image.getAttribute("srcset") ?? "").matchAll(/[?&]w=(\d+)/g)].map(
          (match) => Number(match[1]),
        ),
      ),
    );
  expect(widths.length).toBeGreaterThan(0);
  expect(Math.max(...widths)).toBeLessThanOrEqual(128);
  expect(issues.consoleErrors).toEqual([]);
  expect(issues.failedRequests).toEqual([]);
});

test("archived variant can be neither reached nor added", async ({ page }) => {
  const issues = trackPageIssues(page);
  await withTestDb(
    (sql) =>
      sql`update product_variants set archived_at = now() where domain_id = 'e2e-loyal--green-l'`,
  );
  try {
    await page.goto(`/products/${LOYAL.slug}?variant=e2e-loyal--green-s`);
    await expect(radio(page, "الحجم", "كبير")).toHaveAttribute(
      "data-state",
      "adjusts",
    );
    await radio(page, "الحجم", "كبير").click();
    // The colour moves instead of landing on the archived green · كبير.
    await expect(radio(page, "اللون", "أخضر")).toHaveAttribute(
      "aria-checked",
      "false",
    );
    await expect(page).not.toHaveURL(/green-l/);

    await page.goto(`/products/${LOYAL.slug}?variant=e2e-loyal--green-l`);
    await expect(page).toHaveURL(/variant=e2e-loyal--green-l/);
    await expect(radio(page, "اللون", "زهري")).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await page
      .locator(".product-detail-actions")
      .getByRole("button", { name: "أضف إلى السلة" })
      .click();
    const saved = JSON.parse(
      (await page.evaluate(() =>
        window.localStorage.getItem("souq-maythalun:cart:v3"),
      ))!,
    ) as { lines: Array<{ variantId: string }> };
    expect(saved.lines.map((line) => line.variantId)).not.toContain(
      "e2e-loyal--green-l",
    );
  } finally {
    await withTestDb(
      (sql) =>
        sql`update product_variants set archived_at = null where domain_id = 'e2e-loyal--green-l'`,
    );
  }
  expect(issues.consoleErrors).toEqual([]);
});

test("a missing image keeps its space and shows a placeholder, without errors or retries", async ({
  page,
}) => {
  await withTestDb(
    (sql) =>
      sql`update product_images set src = '/products/does-not-exist.webp'
        where src = '/products/lilac-air-blue-real.webp'
          and product_id = (select id from products where domain_id = ${LOYAL.domainId})`,
  );
  const imageRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("does-not-exist"))
      imageRequests.push(request.url());
  });
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      !/404|Failed to load resource/.test(message.text())
    )
      consoleErrors.push(message.text());
  });
  try {
    await page.goto(`/products/${LOYAL.slug}?variant=e2e-loyal--blue-s`);
    const stage = page.locator(".product-gallery-stage");
    const before = await stage.boundingBox();
    await expect(stage.locator(".product-gallery-missing")).toBeVisible();
    const after = await stage.boundingBox();
    expect(after!.height).toBeCloseTo(before!.height, 0);
    await page.waitForTimeout(1_000);
    expect(new Set(imageRequests).size).toBeLessThanOrEqual(2);
    expect(consoleErrors).toEqual([]);
  } finally {
    await withTestDb(
      (sql) =>
        sql`update product_images set src = '/products/lilac-air-blue-real.webp'
          where src = '/products/does-not-exist.webp'`,
    );
  }
});

test("gallery fits 360, 390, 768 and 1440: no overflow, no overlap, 44px targets, no layout shift", async ({
  page,
}) => {
  const issues = trackPageIssues(page);
  for (const [width, height] of [
    [360, 800],
    [390, 844],
    [768, 1024],
    [1440, 900],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.goto(`/products/${LOYAL.slug}`);
    await page.evaluate(() => {
      (window as unknown as { cls: number }).cls = 0;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as Array<
          PerformanceEntry & { value: number; hadRecentInput: boolean }
        >) {
          if (!entry.hadRecentInput)
            (window as unknown as { cls: number }).cls += entry.value;
        }
      }).observe({ type: "layout-shift", buffered: true });
    });
    const gallery = page.getByRole("region", { name: `صور ${LOYAL.name}` });
    await expect(gallery).toBeVisible();
    await expectNoHorizontalOverflow(page);

    // Thumbnails sit inside the first screen, right under the main image.
    const stage = (await gallery
      .locator(".product-gallery-stage")
      .boundingBox())!;
    const thumbs = (await gallery
      .locator(".product-gallery-thumbs")
      .boundingBox())!;
    expect(thumbs.y).toBeLessThan(height);
    if (width < 1024)
      expect(thumbs.y - (stage.y + stage.height)).toBeLessThan(24);
    expect(stage.height).toBeLessThanOrEqual(height * 0.62);

    // Gallery and options never overlap.
    const options = (await page.locator(".option-selectors").boundingBox())!;
    const galleryBox = (await gallery.boundingBox())!;
    const overlaps =
      options.x < galleryBox.x + galleryBox.width &&
      galleryBox.x < options.x + options.width &&
      options.y < galleryBox.y + galleryBox.height &&
      galleryBox.y < options.y + options.height;
    expect(overlaps).toBe(false);

    for (const target of await gallery.getByRole("button").all()) {
      const box = (await target.boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
    // Arabic labels are not clipped.
    const clipped = await page
      .locator(
        ".variant-option, .variant-selector-label, .product-detail-content h1",
      )
      .evaluateAll(
        (nodes) =>
          nodes.filter((node) => node.scrollWidth > node.clientWidth + 1)
            .length,
      );
    expect(clipped).toBe(0);

    await gallery.getByRole("button", { name: /— اللون: أزرق$/ }).click();
    await page.waitForTimeout(300);
    const cls = await page.evaluate(
      () => (window as unknown as { cls: number }).cls,
    );
    expect(cls).toBeLessThan(0.01);
    await page.screenshot({
      path: `artifacts/store-ops/product-gallery-${width}.png`,
      fullPage: false,
    });
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`/products/${LOYAL.slug}`);
  expect(
    await page
      .locator(".product-gallery-image")
      .evaluate((element) => getComputedStyle(element).animationName),
  ).toBe("none");
  expect(issues.consoleErrors).toEqual([]);
  expect(issues.failedRequests).toEqual([]);
});

test("admin at 390: unmapped uploads block publishing; mapping blue and pink publishes; a failed mapping keeps the choice", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const issues = trackPageIssues(page);
  const { values } = await seed(DRAFT, "draft", false);
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await page.goto(`/admin/products/${DRAFT.domainId}`);
  const editor = page.getByRole("region", { name: "الصور والخيارات والأصناف" });
  const status = editor.locator(
    ".admin-media-message:not(.admin-mapping-status)",
  );

  await expect(editor.getByLabel("الصور الجديدة تخص")).toHaveValue(
    "unassigned",
  );
  await editor.getByLabel("إضافة صور (JPEG أو PNG أو WebP)").setInputFiles([
    { name: "blue.png", mimeType: "image/png", buffer: await photo("#2255cc") },
    { name: "pink.png", mimeType: "image/png", buffer: await photo("#ff88bb") },
    { name: "box.png", mimeType: "image/png", buffer: await photo("#dddddd") },
  ]);
  await editor.getByRole("button", { name: "رفع الصور" }).click();
  await expect(editor.getByText("٣. الصور (3 من 8)")).toBeVisible();
  const unassigned = editor.getByRole("region", { name: /غير مربوط/ });
  await expect(unassigned.locator("li")).toHaveCount(3);
  await expect(
    editor.getByText("لا يمكن نشر المنتج قبل إكمال ربط الصور بالأصناف."),
  ).toBeVisible();

  const publish = async () => {
    await page.getByLabel("الحالة الجديدة").selectOption("published");
    await page.getByRole("button", { name: "حفظ حالة النشر" }).click();
  };
  await publish();
  await expect(
    page.getByText(
      /المنتج غير جاهز للنشر\..*حدّد لأي لون أو رائحة تتبع هذه الصورة/,
    ),
  ).toBeVisible();
  await expect(page.getByTestId("publication-state")).toHaveText(
    "مسودة — لا يظهر في المتجر",
  );

  // A mapping to a value that disappeared meanwhile fails; the choice stays on screen.
  await withTestDb(
    (sql) =>
      sql`update product_option_values set archived_at = now() where id = ${values.green}`,
  );
  const first = unassigned.locator("li").first().getByLabel("الصورة تخص");
  await first.selectOption({ label: "اللون: أخضر" });
  await expect(status).toContainText("هذا العنصر مؤرشف.");
  await expect(first).toHaveValue(`value:${values.green}`);
  await expect(unassigned.locator("li img")).toHaveCount(3);
  await withTestDb(
    (sql) =>
      sql`update product_option_values set archived_at = null where id = ${values.green}`,
  );
  await page.reload();

  const items = editor.locator(".admin-gallery-item");
  await items
    .nth(0)
    .getByLabel("الصورة تخص")
    .selectOption({ label: "اللون: أزرق" });
  await expect(status).toHaveText("تم ربط الصورة.");
  await items
    .nth(1)
    .getByLabel("الصورة تخص")
    .selectOption({ label: "اللون: زهري" });
  await expect(status).toHaveText("تم ربط الصورة.");
  await items
    .nth(2)
    .getByLabel("الصورة تخص")
    .selectOption({ label: "صورة عامة للمنتج" });
  await expect(status).toHaveText("تم ربط الصورة.");
  await expect(editor.getByRole("region", { name: /غير مربوط/ })).toHaveCount(
    0,
  );

  // Green has no picture yet: publishing stays blocked until the owner explicitly chooses the shared one.
  await expect(
    editor
      .getByText(
        "اللون «أخضر» لا يملك صورة. أضف صورة أو اختر استخدام الصورة العامة.",
      )
      .first(),
  ).toBeVisible();
  const summary = editor.locator(".admin-mapping-summary li", {
    hasText: "اللون: أخضر",
  });
  await summary.getByLabel("استخدام الصورة العامة للمنتج").click();
  await expect(status).toHaveText("ستظهر الصورة العامة لهذه القيمة.");
  await expect(
    editor.getByText("كل الصور مربوطة، ويمكن نشر المنتج."),
  ).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({
    path: "artifacts/store-ops/admin-image-mapping-390.png",
    fullPage: true,
  });

  await publish();
  await expect(page.getByTestId("publication-state")).toHaveText(
    "منشور في المتجر",
  );
  const rows = await withTestDb(
    (sql) => sql<{ scope: string; value: string | null }[]>`
      select i.scope, v.value_ar as value from product_images i
      left join product_option_values v on v.id = i.option_value_id
      join products p on p.id = i.product_id
      where p.domain_id = ${DRAFT.domainId} order by i.sort_order`,
  );
  expect(rows.map((row) => [row.scope, row.value])).toEqual(
    expect.arrayContaining([
      ["option_value", "أزرق"],
      ["option_value", "زهري"],
      ["product", null],
    ]),
  );
  expect(issues.consoleErrors).toEqual([]);
  expect(issues.failedRequests).toEqual([]);
});

test("assistant: mapping card changes nothing before confirmation, «نعم» does nothing, a double tap applies once", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const issues = trackPageIssues(page);
  await withTestDb(async (sql) => {
    await sql`
      update product_images set scope = 'unassigned', option_id = null, option_value_id = null, is_primary = false
      where src = '/products/lilac-air-group.webp'
        and product_id = (select id from products where domain_id = ${LOYAL.domainId})`;
  });
  const mapping = () =>
    withTestDb(
      (sql) => sql<{ scope: string; value: string | null }[]>`
        select i.scope, v.value_ar as value from product_images i
        left join product_option_values v on v.id = i.option_value_id
        where i.src = '/products/lilac-air-group.webp'`,
    );
  const audits = () =>
    withTestDb(
      (sql) => sql<{ total: number }[]>`
        select count(*)::int as total from admin_audit_events where action_type = 'product_image_scope'`,
    );
  const auditsBefore = (await audits())[0]!.total;

  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await page.getByRole("button", { name: "فتح المساعد" }).click();
  const panel = page.getByRole("dialog", { name: "المساعد" });
  const ask = async (text: string) => {
    await panel.getByLabel("رسالتك للمساعد").fill(text);
    await panel.getByRole("button", { name: "إرسال" }).click();
  };
  // Image 6 is the last one in the gallery order (primary first).
  await ask(`اربطي الصورة 6 من ${LOYAL.name} باللون أزرق`);
  const card = panel.getByRole("region", {
    name: `ربط صورة بالأصناف: ${LOYAL.name}`,
  });
  await expect(card).toBeVisible();
  await expect(card).toContainText("غير مربوطة");
  await expect(card).toContainText("اللون: أزرق");
  await expect(card.locator("img").first()).toBeVisible();
  expect(await mapping()).toEqual([{ scope: "unassigned", value: null }]);

  await ask("نعم");
  await page.waitForTimeout(1_500);
  await expect(card).toContainText("بانتظار تأكيدك");
  expect(await mapping()).toEqual([{ scope: "unassigned", value: null }]);

  await card.getByRole("button", { name: "تأكيد" }).dblclick();
  await expect(card.getByRole("status")).toContainText("تم ربط الصورة.");
  expect(await mapping()).toEqual([{ scope: "option_value", value: "أزرق" }]);
  expect((await audits())[0]!.total - auditsBefore).toBe(1);
  expect(issues.consoleErrors).toEqual([]);
});
