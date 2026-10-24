import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { expectNoHorizontalOverflow } from "./support";

const PRODUCT = "/products/general-cleaner-secret";

async function expectAccessible(page: Page) {
  const axe = await new AxeBuilder({ page })
    .include("main")
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(axe.violations.map((violation) => violation.id)).toEqual([]);
}

for (const locale of ["ar", "en"] as const) {
  const prefix = locale === "en" ? "/en" : "";

  test(`branded 404 offers a way back (${locale})`, async ({ page }) => {
    const response = await page.goto(`${prefix}/no-such-page-redesign`);
    expect(response?.status()).toBe(404);
    const main = page.getByRole("main");
    await expect(main.locator(".status-brand-symbol")).toBeVisible();
    await expect(
      main.getByRole("link", {
        name: locale === "en" ? "Back to the store" : "العودة إلى المتجر",
      }),
    ).toHaveAttribute("href", prefix || "/");
    await expect(
      main.getByRole("link", {
        name: locale === "en" ? "Browse categories" : "تصفّح الأقسام",
      }),
    ).toHaveAttribute("href", `${prefix}/categories`);
    await expectAccessible(page);
  });

  test(`empty wishlist and the delivery page pass axe (${locale})`, async ({
    page,
  }) => {
    for (const path of ["/favorites", "/delivery"]) {
      await page.goto(`${prefix}${path}`);
      await expect(page.locator("main")).toBeVisible();
      await expectAccessible(page);
      await expectNoHorizontalOverflow(page);
    }
  });
}

for (const viewport of [
  { width: 320, height: 640 },
  { width: 390, height: 844 },
]) {
  test(`add to cart is reachable without scrolling on a ${viewport.width}px phone`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto(PRODUCT);
    const add = page.locator(".detail-add-button");
    await expect(add).toBeEnabled();
    const button = await add.boundingBox();
    const navigation = await page.locator(".mobile-navigation").boundingBox();
    expect(button).not.toBeNull();
    expect(navigation).not.toBeNull();
    // Fully on screen and above the fixed bottom navigation.
    expect(button!.y).toBeGreaterThanOrEqual(0);
    expect(button!.y + button!.height).toBeLessThanOrEqual(navigation!.y);
    await expectNoHorizontalOverflow(page);

    await add.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator(".cart-confirmation")).not.toBeEmpty();
  });
}
