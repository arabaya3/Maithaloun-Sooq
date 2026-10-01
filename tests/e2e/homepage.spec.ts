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

test("homepage search, filtering, and cart work in RTL", async ({ page }) => {
  const issues = trackPageIssues(page);
  await page.goto("/");

  await expect(page.locator("html")).toHaveAttribute("lang", "ar");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(
    page.getByRole("link", { name: /^سوق ميثلون\s?، الرئيسية$/ }),
  ).toBeVisible();
  const search = page.getByRole("searchbox", {
    name: "ابحث في المنتجات",
  });
  await search.fill("Arar");
  await expect(page.getByText("سائل جلي Arar")).toBeVisible();
  await expect(page.getByText("منظف عام Secret")).toBeHidden();

  const product = page.locator("article").filter({ hasText: "سائل جلي Arar" });
  await product.getByRole("button", { name: "أضف إلى السلة" }).click();
  await expect(page.locator(".cart-button")).toHaveAccessibleName(
    "السلة، عدد المنتجات 1",
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

test("brand name is spelled سوق ميثلون everywhere it renders", async ({
  page,
}) => {
  for (const route of [
    "/",
    "/products/general-cleaner-secret",
    "/cart",
    "/checkout",
    "/offers",
    "/categories",
    "/account",
  ]) {
    await page.goto(route);
    const word = page.locator("header .brand .brand-word");
    const visible = await word.evaluate((element) =>
      [...element.children]
        .filter((child) => !child.classList.contains("sr-only"))
        .map((child) => (child as HTMLElement).innerText)
        .join(" "),
    );
    expect(visible).toBe("سوق ميثلون");
    await expect(page.locator("header .brand-tagline")).toHaveText(
      "منظفات ومعطرات جو",
    );
    expect(await page.locator("body").innerText()).not.toContain("سوق ميثون");
    expect(await page.content()).not.toContain("سوق ميثون");
  }
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
  const location = page.locator(".hero-facts");
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
  await expect(page.locator(".hero-facts")).toContainText("توصيل داخل ميثلون");
  expect(
    await location.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);

  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("link", { name: "ابدأ التسوق" })).toBeVisible();

  const categoryList = page.locator(".category-list");
  const firstCategory = page.getByRole("button", { name: "الكل" });
  const lastCategory = page.getByRole("button", {
    name: "مستلزمات منزلية",
  });

  const listBox = await categoryList.boundingBox();
  const firstBox = await firstCategory.boundingBox();
  expect(listBox).not.toBeNull();
  expect(firstBox).not.toBeNull();
  expect(firstBox!.x).toBeGreaterThanOrEqual(listBox!.x - 1);
  expect(firstBox!.y).toBeGreaterThanOrEqual(listBox!.y - 1);

  await lastCategory.evaluate((element) =>
    element.scrollIntoView({ block: "nearest", inline: "nearest" }),
  );
  const lastBox = await lastCategory.boundingBox();
  expect(lastBox).not.toBeNull();
  expect(lastBox!.y).toBeGreaterThanOrEqual(listBox!.y - 1);
  await lastCategory.click();
  await expect(lastCategory).toHaveAttribute("aria-pressed", "true");

  await firstCategory.click();
  const finalAction = page
    .locator(".product-card")
    .last()
    .locator(".product-actions");
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
  expect(spacing.token).toBe("4.25rem");
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
    await expect(page.getByRole("link", { name: "ابدأ التسوق" })).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
    expect(issues.consoleErrors).toEqual([]);
    expect(issues.failedRequests).toEqual([]);
  });
}

test("keyboard users reach search and products in RTL order with a visible focus ring", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  expect(
    await page.evaluate(() => getComputedStyle(document.body).direction),
  ).toBe("rtl");

  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: /^سوق ميثلون\s?، الرئيسية$/ }),
  ).toBeFocused();

  const search = page.getByRole("searchbox", { name: "ابحث في المنتجات" });
  for (
    let step = 0;
    step < 6 && !(await search.evaluate((el) => el === document.activeElement));
    step += 1
  ) {
    await page.keyboard.press("Tab");
  }
  await expect(search).toBeFocused();
  expect(
    await search.evaluate((el) => getComputedStyle(el).outlineStyle),
  ).not.toBe("none");

  await page.keyboard.press("Tab");
  const focused = page.locator(":focus");
  await expect(focused).toHaveText(/ابدأ التسوق/);
  expect(
    await focused.evaluate((el) => getComputedStyle(el).outlineStyle),
  ).not.toBe("none");
});

test("product rows add to the cart, then change quantity in place", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const card = page
    .locator(".product-card")
    .filter({ hasText: "منظف عام Secret" });

  await card.getByRole("button", { name: "أضف إلى السلة" }).click();
  await card
    .getByRole("button", { name: "زيادة كمية منظف عام Secret" })
    .click();
  await expect(card.locator(".card-quantity output")).toHaveText("2");
  await expect(page.locator(".cart-button")).toHaveAccessibleName(
    "السلة، عدد المنتجات 2",
  );

  await card
    .getByRole("button", { name: "تقليل كمية منظف عام Secret" })
    .click();
  await card
    .getByRole("button", { name: "إزالة منظف عام Secret من السلة" })
    .click();
  await expect(
    card.getByRole("button", { name: "أضف إلى السلة" }),
  ).toBeVisible();
});

test("bottom navigation targets are at least 44px and mark the current page", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/offers");
  const links = page.locator(".mobile-navigation a");
  await expect(links).toHaveCount(4);
  for (const box of await links.evaluateAll((items) =>
    items.map((item) => item.getBoundingClientRect().toJSON()),
  )) {
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
  await expect(
    page.locator(".mobile-navigation").getByRole("link", { name: "العروض" }),
  ).toHaveAttribute("aria-current", "page");
});
