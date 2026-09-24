import { expect, test, type Page } from "@playwright/test";

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

test("product details, favorites, and cart stay synchronized", async ({
  page,
}) => {
  const issues = trackPageIssues(page);
  await page.goto("/");

  const card = page
    .locator('[data-product-id="general-cleaner"]')
    .filter({ hasText: "منظف عام Secret" });
  await card.getByRole("link", { name: "عرض تفاصيل منظف عام Secret" }).click();
  await expect(page).toHaveURL(/\/products\/general-cleaner-secret$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "منظف عام Secret" }),
  ).toBeVisible();

  const favorite = page.getByRole("button", {
    name: "إضافة منظف عام Secret إلى المفضلة",
  });
  await favorite.click();
  await expect(
    page.getByRole("button", {
      name: "إزالة منظف عام Secret من المفضلة",
    }),
  ).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("button", { name: "أضف إلى السلة" }).click();
  await expect(page.locator(".cart-button")).toHaveAccessibleName(
    "السلة، منتج واحد",
  );
  await expect(
    page.getByText("تمت إضافة منظف عام Secret إلى السلة."),
  ).toBeVisible();

  await page.getByRole("link", { name: "سوق ميثلون، الرئيسية" }).click();
  await expect(
    page.getByRole("button", {
      name: "إزالة منظف عام Secret من المفضلة",
    }),
  ).toHaveAttribute("aria-pressed", "true");

  await page.locator(".cart-button").click();
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
  await page.goto("/");
  await expect(page.getByLabel("منطقة التوصيل")).toHaveText(
    "التوصيل داخل ميثلون",
  );
  await page.reload();
  await expect(page.getByLabel("منطقة التوصيل")).toHaveText(
    "التوصيل داخل ميثلون",
  );
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
