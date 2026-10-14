import { expect, test, type Page } from "@playwright/test";

import { expectNoHorizontalOverflow, withTestDb } from "./support";

// Two seeded products get real photos for these checks: one photo for the bleach, two for the dish liquid.
const SINGLE = "dolphin-bleach";
const DOUBLE = "arar-dish-liquid";
const USAGE_TEXT =
  "مبيض قوي للغسيل الأبيض.\nطريقة الاستعمال:\nيُضاف غطاء واحد إلى ماء الغسيل.";

test.describe.configure({ mode: "serial" });

let saved: { slug: string; description: string | null }[] = [];

test.beforeAll(async () => {
  await withTestDb(async (sql) => {
    saved =
      await sql`select slug, description from products where slug in (${SINGLE}, ${DOUBLE})`;
    await sql`update products set description = ${USAGE_TEXT} where slug = ${SINGLE}`;
    await sql`
      insert into product_images (product_id, scope, variant_id, option_id, option_value_id, src, alt_ar, width, height, sort_order, is_primary)
      select id, 'product', null, null, null, '/products/dolphin-bleach-real.webp', name_ar, 1000, 1000, 0, true
      from products where slug = ${SINGLE}`;
    await sql`
      insert into product_images (product_id, scope, variant_id, option_id, option_value_id, src, alt_ar, width, height, sort_order, is_primary)
      select products.id, 'product', null, null, null, images.src, products.name_ar, 1000, 1000, images.sort_order, images.sort_order = 0
      from products, (values ('/products/arar-dish-real.webp', 0), ('/products/arar-oven-cleaner-real.webp', 1)) as images(src, sort_order)
      where slug = ${DOUBLE}`;
  });
});

test.afterAll(async () => {
  await withTestDb(async (sql) => {
    await sql`delete from product_images where product_id in (select id from products where slug in (${SINGLE}, ${DOUBLE}))`;
    for (const row of saved)
      await sql`update products set description = ${row.description} where slug = ${row.slug}`;
  });
});

async function stageBox(page: Page, slug: string) {
  await page.goto(`/products/${slug}`);
  const stage = page.locator(".product-gallery-stage");
  await expect(stage).toBeVisible();
  return (await stage.boundingBox())!;
}

test("one photo and several photos share the same gallery stage", async ({
  page,
}) => {
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const single = await stageBox(page, SINGLE);
    await expect(page.locator(".product-gallery-thumbs")).toHaveCount(0);
    await expect(page.locator(".product-gallery-arrows")).toHaveCount(0);
    const double = await stageBox(page, DOUBLE);
    await expect(page.locator(".product-gallery-thumbs button")).toHaveCount(2);
    expect(Math.abs(single.width - double.width)).toBeLessThanOrEqual(2);
    expect(Math.abs(single.height - double.height)).toBeLessThanOrEqual(2);
    await expectNoHorizontalOverflow(page);
  }
});

test("desktop hover zoom stays inside the stage and works after changing photo", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await stageBox(page, DOUBLE);
  const stage = page.locator(".product-gallery-stage");
  const box = (await stage.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.3);
  await expect(stage).toHaveAttribute("data-zooming", "true");
  await page.locator(".product-gallery-thumbs button").nth(1).click();
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.6);
  await expect(stage).toHaveAttribute("data-zooming", "true");
  await expect(page.locator(".product-gallery-image")).toHaveAttribute(
    "src",
    /arar-oven-cleaner/,
  );
  // Clipped: the stage hides the overflow, so the zoomed photo never covers the details.
  expect(await stage.evaluate((node) => getComputedStyle(node).overflow)).toBe(
    "hidden",
  );
  await page.mouse.move(5, 5);
  await expect(stage).toHaveAttribute("data-zooming", "false");
});

test("phones open a full-screen viewer with navigation and a close button", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await stageBox(page, DOUBLE);
  await page
    .getByRole("button", { name: "فتح الصورة بحجم كامل" })
    .click({ position: { x: 150, y: 150 } });
  const viewer = page.getByRole("dialog", { name: "فتح الصورة بحجم كامل" });
  await expect(viewer).toBeVisible();
  await expect(viewer.locator("img")).toHaveAttribute("src", /arar-dish-real/);
  await viewer.getByRole("button", { name: "الصورة التالية" }).click();
  await expect(viewer.locator("img")).toHaveAttribute(
    "src",
    /arar-oven-cleaner/,
  );
  await viewer.getByRole("button", { name: "إغلاق" }).click();
  await expect(viewer).toHaveCount(0);
});

test("description and usage render as separate sections with the text kept", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/products/${SINGLE}`);
  await expect(page.getByRole("heading", { name: "وصف المنتج" })).toBeVisible();
  const usage = page.locator(".product-info-usage");
  await expect(usage.getByRole("heading")).toHaveText("طريقة الاستعمال");
  await expect(usage).toContainText("يُضاف غطاء واحد إلى ماء الغسيل.");
  await expect(page.locator(".product-info")).not.toContainText(
    "طريقة الاستعمال:",
  );
});

test("the home page has no curated collections and ends cleanly on the footer", async ({
  page,
}) => {
  for (const [width, path] of [
    [1440, "/"],
    [1440, "/cart"],
    [390, "/"],
    [390, "/en/cart"],
  ] as const) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(path);
    if (path === "/")
      await expect(page.getByText("تشكيلات مختارة")).toHaveCount(0);
    const gap = await page.evaluate(() => {
      const footer = document.querySelector(".store-footer")!;
      const rect = footer.getBoundingClientRect();
      return {
        below:
          document.documentElement.scrollHeight -
          (rect.bottom + window.scrollY),
        left: rect.left,
        right: window.innerWidth - rect.right,
      };
    });
    expect(Math.abs(gap.below), `${path} at ${width}`).toBeLessThanOrEqual(1);
    expect(gap.left).toBeLessThanOrEqual(0);
    expect(gap.right).toBeLessThanOrEqual(1);
    await expectNoHorizontalOverflow(page);
  }
});

test("on a phone, a tap still opens the viewer right after swiping photos", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await stageBox(page, DOUBLE);
  const box = (await page.locator(".product-gallery-stage").boundingBox())!;
  const y = box.y + box.height / 2;
  const x = box.x + box.width / 2;
  // Arabic reads right to left, so the finger moves right to reach the next photo.
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: x - 100, y }],
  });
  for (let step = 1; step <= 8; step++)
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: x - 100 + step * 25, y }],
    });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await expect(page.locator(".product-gallery-image")).toHaveAttribute(
    "src",
    /arar-oven-cleaner/,
  );
  await expect(page.locator(".gallery-viewer")).toHaveCount(0);
  await page.touchscreen.tap(x, y);
  await expect(page.locator(".gallery-viewer")).toHaveCount(1);
  await context.close();
});

test("on a 320 px phone, a tap opens the viewer and it stays open", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 320, height: 700 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  await stageBox(page, DOUBLE);
  const box = (await page.locator(".product-gallery-stage").boundingBox())!;
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(500);
  await expect(page.locator(".gallery-viewer")).toHaveCount(1);
  await page.locator(".gallery-viewer-close").tap();
  await expect(page.locator(".gallery-viewer")).toHaveCount(0);
  await context.close();
});
