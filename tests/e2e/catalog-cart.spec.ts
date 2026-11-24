import { expect, test, type Page } from "@playwright/test";
import { openCart } from "./support";

function trackPageIssues(page: Page) {
  const consoleErrors: string[] = [];
  const failedRequests: string[] = [];

  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("requestfailed", (request) => {
    if (request.failure()?.errorText === "net::ERR_ABORTED") return;
    failedRequests.push(`${request.method()} ${request.url()}`);
  });

  return { consoleErrors, failedRequests };
}

test("product details and cart stay synchronized", async ({ page }) => {
  const issues = trackPageIssues(page);
  await page.goto("/");

  const card = page
    .locator('[data-product-id="general-cleaner"]')
    .filter({ hasText: "منظف عام Secret" });
  await card.getByRole("link", { name: /منظف عام Secret/ }).click();
  await expect(page).toHaveURL(/\/products\/general-cleaner-secret$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "منظف عام Secret" }),
  ).toBeVisible();

  await page
    .locator(".product-detail-actions")
    .getByRole("button", { name: "أضف إلى السلة" })
    .click();
  // Phones carry the cart in the bottom bar, with its count.
  await expect(page.locator(".mobile-navigation .cart-count")).toHaveText("1");
  await expect(
    page.getByText("تمت إضافة منظف عام Secret إلى السلة."),
  ).toBeVisible();

  await page
    .getByRole("link", { name: /^MAYTHA MARKET\s?، الرئيسية$/ })
    .click();
  await openCart(page);
  await expect(
    page.getByRole("heading", { level: 1, name: "سلة التسوق" }),
  ).toBeVisible();
  await expect(page.getByLabel("مجموع المنتجات 7 ₪")).toBeVisible();

  await page
    .getByRole("button", { name: "زيادة كمية منظف عام Secret" })
    .click();
  await expect(page.getByLabel("مجموع المنتجات 14 ₪")).toBeVisible();

  await page
    .getByRole("button", { name: "إزالة منظف عام Secret من السلة" })
    .click();
  await expect(page.getByRole("heading", { name: "سلتك فارغة" })).toBeVisible();
  expect(issues.consoleErrors).toEqual([]);
  expect(issues.failedRequests).toEqual([]);
});

test("delivery area indicator is fixed to ميثلون", async ({ page }) => {
  // The home strip is gone; the product page still states the delivery area and the free threshold.
  for (let round = 0; round < 2; round += 1) {
    await page.goto("/products/general-cleaner-secret");
    await page.getByText("التوصيل والدفع", { exact: true }).click();
    const delivery = page.locator(".product-trust li").first();
    await expect(delivery).toBeVisible();
    await expect(delivery).toContainText("توصيل داخل ميثلون");
    await expect(delivery).toContainText("100");
  }
  await page.goto("/");
  await expect(page.locator(".hero-facts, .store-benefits")).toHaveCount(0);
});

test("unknown product slug returns not found", async ({ page }) => {
  const response = await page.goto("/products/not-a-real-product");
  expect(response?.status()).toBe(404);
});

for (const viewport of [
  { width: 360, height: 800 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1440, height: 900 },
]) {
  test(`product and cart avoid overflow at ${viewport.width}x${viewport.height}`, async ({
    page,
  }) => {
    const issues = trackPageIssues(page);
    await page.setViewportSize(viewport);

    for (const route of ["/products/general-cleaner-secret", "/cart"]) {
      await page.goto(route);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(overflow).toBeLessThanOrEqual(1);
    }

    expect(issues.consoleErrors).toEqual([]);
    expect(issues.failedRequests).toEqual([]);
  });
}
