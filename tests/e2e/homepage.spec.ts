import { expect, test, type Page } from "@playwright/test";

function trackPageIssues(page: Page) {
  const consoleErrors: string[] = [];
  const failedRequests: string[] = [];

  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("requestfailed", (request) => {
    failedRequests.push(`${request.method()} ${request.url()}`);
  });

  return { consoleErrors, failedRequests };
}

test("homepage search, filtering, and cart work in RTL", async ({ page }) => {
  const issues = trackPageIssues(page);
  await page.goto("/");

  await expect(page.locator("html")).toHaveAttribute("lang", "ar");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(
    page.getByRole("link", { name: "سوق ميثلون، الرئيسية" }),
  ).toBeVisible();
  const search = page.getByRole("searchbox", {
    name: "ابحث في منتجات التنظيف",
  });
  await search.fill("Arar");
  await expect(page.getByText("سائل جلي Arar")).toBeVisible();
  await expect(page.getByText("منظف عام Secret")).toBeHidden();

  const product = page.locator("article").filter({ hasText: "سائل جلي Arar" });
  await product.getByRole("button", { name: /^أضف$/ }).click();
  await expect(page.locator(".cart-button")).toHaveAccessibleName(
    "السلة، منتج واحد",
  );

  await search.clear();
  await page.getByRole("button", { name: "منظفات المطبخ" }).click();
  await expect(page.getByText("سائل جلي Arar")).toBeVisible();
  await expect(page.getByText("مبيض Dolphin")).toBeHidden();

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
  expect(issues.consoleErrors).toEqual([]);
  expect(issues.failedRequests).toEqual([]);
});

test("placeholder navigation routes resolve successfully", async ({ page }) => {
  for (const route of ["/categories", "/offers", "/account"]) {
    const response = await page.goto(route);
    expect(response?.status()).toBe(200);
    await expect(
      page.getByRole("link", { name: "العودة إلى الرئيسية" }),
    ).toBeVisible();
  }
});

test("mobile header, hero, RTL categories, and bottom spacing remain usable", async ({
  page,
}) => {
  const issues = trackPageIssues(page);
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/");

  const brand = page.locator(".brand");
  const cart = page.locator(".cart-button");
  const location = page.locator(".location-control");
  const [brandBox, cartBox, locationBox] = await Promise.all([
    brand.boundingBox(),
    cart.boundingBox(),
    location.boundingBox(),
  ]);

  expect(brandBox).not.toBeNull();
  expect(cartBox).not.toBeNull();
  expect(locationBox).not.toBeNull();
  expect(Math.abs(brandBox!.y - cartBox!.y)).toBeLessThan(10);
  expect(locationBox!.y).toBeGreaterThan(brandBox!.y + brandBox!.height);
  await expect(
    page.getByRole("combobox", { name: "منطقة التوصيل" }),
  ).toHaveValue("");
  expect(
    await location.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);

  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "تسوّق المنتجات" }),
  ).toBeVisible();

  const categoryList = page.locator(".category-list");
  const firstCategory = page.getByRole("button", { name: "الكل" });
  const lastCategory = page.getByRole("button", {
    name: "مستلزمات منزلية",
  });

  const listBox = await categoryList.boundingBox();
  const firstBox = await firstCategory.boundingBox();
  expect(listBox).not.toBeNull();
  expect(firstBox).not.toBeNull();
  expect(firstBox!.x).toBeGreaterThanOrEqual(listBox!.x);
  expect(firstBox!.x + firstBox!.width).toBeLessThanOrEqual(
    listBox!.x + listBox!.width,
  );
  expect(
    await categoryList.evaluate((list) => {
      const viewport = list.getBoundingClientRect();
      return Array.from(list.children)
        .map((item) => item.getBoundingClientRect())
        .filter(
          (item) => item.right > viewport.left && item.left < viewport.right,
        )
        .every(
          (item) => item.left >= viewport.left && item.right <= viewport.right,
        );
    }),
  ).toBe(true);

  await lastCategory.evaluate((element) =>
    element.scrollIntoView({ block: "nearest", inline: "end" }),
  );
  const lastBox = await lastCategory.boundingBox();
  expect(lastBox).not.toBeNull();
  expect(lastBox!.x).toBeGreaterThanOrEqual(listBox!.x);
  expect(lastBox!.x + lastBox!.width).toBeLessThanOrEqual(
    listBox!.x + listBox!.width,
  );
  await lastCategory.click();
  await expect(lastCategory).toHaveAttribute("aria-pressed", "true");

  await firstCategory.click();
  const finalAction = page
    .locator(".product-card")
    .last()
    .locator(".add-button");
  await page.evaluate(() =>
    window.scrollTo({
      top: document.documentElement.scrollHeight,
      behavior: "smooth",
    }),
  );
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          Math.ceil(window.scrollY + window.innerHeight) >=
          document.documentElement.scrollHeight - 1,
      ),
    )
    .toBe(true);

  const navigation = page.locator(".mobile-navigation");
  const actionBox = await finalAction.boundingBox();
  const navigationBox = await navigation.boundingBox();
  expect(actionBox).not.toBeNull();
  expect(navigationBox).not.toBeNull();
  expect(actionBox!.y + actionBox!.height).toBeLessThanOrEqual(
    navigationBox!.y,
  );

  const spacing = await page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    return {
      token: root.getPropertyValue("--mobile-nav-height").trim(),
      bodyPadding: Number.parseFloat(
        getComputedStyle(document.body).paddingBottom,
      ),
      navigationHeight: document
        .querySelector(".mobile-navigation")!
        .getBoundingClientRect().height,
    };
  });
  expect(spacing.token).toBe("4.75rem");
  expect(spacing.bodyPadding).toBeGreaterThan(spacing.navigationHeight);
  expect(issues.consoleErrors).toEqual([]);
  expect(issues.failedRequests).toEqual([]);
});

for (const viewport of [
  { width: 360, height: 800 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1440, height: 900 },
]) {
  test(`has no horizontal overflow at ${viewport.width}x${viewport.height}`, async ({
    page,
  }) => {
    const issues = trackPageIssues(page);
    await page.setViewportSize(viewport);
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(
      page.getByRole("link", { name: "تسوّق المنتجات" }),
    ).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
    expect(issues.consoleErrors).toEqual([]);
    expect(issues.failedRequests).toEqual([]);
  });
}
