import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { expectNoHorizontalOverflow, withTestDb } from "./support";

const SHOTS = "artifacts/languages";

async function documentLanguage(page: Page) {
  return page.evaluate(() => ({
    lang: document.documentElement.lang,
    dir: document.documentElement.dir,
    direction: getComputedStyle(document.body).direction,
  }));
}

test.describe("an English browser", () => {
  test.use({ locale: "en-US" });

  test("lands on English, left to right, with English chrome and hreflang links", async ({
    page,
  }) => {
    const response = await page.goto("/");
    expect(response?.status()).toBe(200);
    await expect(page).toHaveURL(/\/en$/);
    expect(await documentLanguage(page)).toEqual({
      lang: "en",
      dir: "ltr",
      direction: "ltr",
    });
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: "Original Brands for a Cleaner, Brighter Home",
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("searchbox", { name: "Search products" }),
    ).toBeVisible();
    await expect(
      page.locator('link[rel="alternate"][hreflang="ar"]'),
    ).toHaveAttribute("href", /:\d+\/?$/);
    await expect(
      page.locator('link[rel="alternate"][hreflang="en"]'),
    ).toHaveAttribute("href", /\/en$/);
    // Prices stay in shekels.
    await expect(page.locator(".product-price").first()).toContainText("₪");
    await expectNoHorizontalOverflow(page);
    const axe = await new AxeBuilder({ page })
      .include("main")
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(axe.violations.map((violation) => violation.id)).toEqual([]);
    for (const [width, height] of [
      [390, 844],
      [1440, 900],
    ] as const) {
      await page.setViewportSize({ width, height });
      await page.screenshot({
        path: `${SHOTS}/home-en-${width}.png`,
        fullPage: true,
      });
    }
  });

  test("keeps English through product, cart and checkout, and shows original names when no English one exists", async ({
    page,
  }) => {
    await withTestDb(
      (sql) =>
        sql`update products set name_en = 'Dolphin Bleach' where domain_id = 'dolphin-bleach'`,
    );
    try {
      await page.goto("/en");
      // Owner-written English name, and the original name where there is none.
      await expect(
        page.locator('[data-product-id="dolphin-bleach"] h3'),
      ).toHaveText("Dolphin Bleach");
      await expect(
        page.locator('[data-product-id="general-cleaner"] h3'),
      ).toHaveText("منظف عام Secret");

      await page
        .locator('[data-product-id="general-cleaner"]')
        .getByRole("link")
        .first()
        .click();
      await expect(page).toHaveURL(/\/en\/products\/general-cleaner-secret$/);
      await expect(page.locator("html")).toHaveAttribute("lang", "en");

      await page.goto("/en");
      await page
        .locator('[data-product-id="general-cleaner"]')
        .getByRole("button", { name: "Add to cart" })
        .click();
      await page.locator(".cart-button").click();
      await expect(page).toHaveURL(/\/en\/cart$/);
      await expect(
        page.getByRole("heading", { level: 1, name: "Shopping cart" }),
      ).toBeVisible();
      await page.screenshot({
        path: `${SHOTS}/cart-en-390.png`,
        fullPage: true,
      });
      await page.getByRole("link", { name: "Order on the website" }).click();
      await expect(page).toHaveURL(/\/en\/checkout\?channel=web$/);
      await page
        .getByRole("textbox", { name: "Full name" })
        .fill("Test Customer");
      await page
        .getByRole("textbox", { name: "Local number" })
        .fill("0591234567");
      // Nothing may widen the page sideways in a left-to-right layout.
      await expectNoHorizontalOverflow(page);
      await page.screenshot({
        path: `${SHOTS}/checkout-en-390.png`,
        fullPage: true,
      });
      await page.getByRole("button", { name: "Place order" }).click();
      await expect(page).toHaveURL(
        /\/en\/orders\/MS-[A-Za-z0-9_-]{24}\/confirmation$/,
      );
      await expect(
        page.getByRole("heading", {
          level: 1,
          name: "Thank you, your order has reached the store",
        }),
      ).toBeVisible();
    } finally {
      await withTestDb(
        (sql) =>
          sql`update products set name_en = null where domain_id = 'dolphin-bleach'`,
      );
    }
  });

  test("a saved Arabic choice wins over the English browser", async ({
    page,
  }) => {
    await page.goto("/en/categories");
    await page
      .getByRole("link", { name: "التحويل إلى العربية" })
      .first()
      .click();
    await expect(page).toHaveURL(/\/categories$/);
    expect(await documentLanguage(page)).toMatchObject({
      lang: "ar",
      dir: "rtl",
    });
    await expect(
      page.getByRole("heading", { level: 1, name: "الأقسام" }),
    ).toBeVisible();
    // Later visits keep Arabic instead of following the browser.
    await page.goto("/");
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator("html")).toHaveAttribute("lang", "ar");
  });
});

test.describe("other browsers", () => {
  test.describe("Arabic", () => {
    test.use({ locale: "ar-PS" });
    test("stays on the Arabic address, right to left, and can switch to English", async ({
      page,
    }) => {
      await page.goto("/?category=laundry");
      await expect(page).toHaveURL(/\/\?category=laundry$/);
      expect(await documentLanguage(page)).toEqual({
        lang: "ar",
        dir: "rtl",
        direction: "rtl",
      });
      await page
        .getByRole("link", { name: "Switch to English" })
        .first()
        .click();
      // Same page and filter, now in English.
      await expect(page).toHaveURL(/\/en\?category=laundry$/);
      await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
      await page.goto("/offers");
      await expect(page).toHaveURL(/\/en\/offers$/);
    });
  });

  test.describe("an unsupported language", () => {
    test.use({ locale: "fr-FR" });
    test("falls back to English", async ({ page }) => {
      await page.goto("/categories");
      await expect(page).toHaveURL(/\/en\/categories$/);
      await expect(
        page.getByRole("heading", { level: 1, name: "Categories" }),
      ).toBeVisible();
    });
  });
});

test.describe("English pages at phone and desktop widths", () => {
  test.use({ locale: "en-US" });
  for (const width of [360, 1440]) {
    test(`never overflow sideways at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      for (const path of [
        "/en",
        "/en/categories",
        "/en/offers",
        "/en/brands",
        "/en/products/general-cleaner-secret",
        "/en/cart",
        "/en/checkout",
        "/en/favorites",
        "/en/account",
      ]) {
        await page.goto(path);
        await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
        await expectNoHorizontalOverflow(page);
      }
    });
  }
});
