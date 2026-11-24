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

const cartCount = (page: Page) =>
  page.locator(".mobile-navigation .cart-count");

test("homepage search, filtering, and cart work in RTL", async ({ page }) => {
  const issues = trackPageIssues(page);
  await page.goto("/");

  await expect(page.locator("html")).toHaveAttribute("lang", "ar");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(
    page.getByRole("link", { name: /^MAYTHA MARKET\s?، الرئيسية$/ }),
  ).toBeVisible();
  const search = page.getByRole("searchbox", {
    name: "ابحث في المنتجات",
  });
  await search.fill("Arar");
  await expect(page.getByText("سائل جلي Arar")).toBeVisible();
  await expect(page.getByText("منظف عام Secret")).toBeHidden();

  const product = page.locator("article").filter({ hasText: "سائل جلي Arar" });
  await product.getByRole("button", { name: "أضف للسلة" }).click();
  await expect(cartCount(page)).toHaveText("1");

  // The category filter lives in the «تصفية» sheet; the category cards open category pages.
  await search.clear();
  await page.getByRole("button", { name: /تصفية/ }).click();
  const sheet = page.getByRole("dialog", { name: "تصفية المنتجات" });
  await sheet.getByText("منظفات المطبخ", { exact: true }).click();
  await sheet.getByRole("button", { name: /عرض النتائج/ }).click();
  await expect(page.getByText("سائل جلي Arar")).toBeVisible();
  await expect(page.getByText("مبيض Dolphin")).toBeHidden();

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
  expect(issues.consoleErrors).toEqual([]);
  expect(issues.failedRequests).toEqual([]);
});

test("brand name is spelled MAYTHA MARKET everywhere it renders", async ({
  page,
}) => {
  for (const route of [
    "/",
    "/products/general-cleaner-secret",
    "/products",
    "/cart",
    "/checkout",
    "/categories",
    "/favorites",
    "/account",
  ]) {
    await page.goto(route);
    // The header carries the official logo image; its text alternative is the store name.
    await expect(
      page.locator("header .brand").getByRole("img", { name: "MAYTHA MARKET" }),
    ).toBeVisible();
    expect(await page.locator("body").innerText()).not.toMatch(
      /سوق ميثلون|سوق ميثون/,
    );
  }
});

test("navigation routes resolve successfully", async ({ page }) => {
  // The offers section left the storefront; old links land on the home page.
  await page.goto("/offers");
  await expect(page).toHaveURL(/\/$/);
  await expect(
    page.getByRole("heading", { level: 2, name: "وصل حديثًا" }),
  ).toBeVisible();
  const all = await page.goto("/products");
  expect(all?.status()).toBe(200);
  await expect(
    page.getByRole("heading", { level: 1, name: "كل المنتجات" }),
  ).toBeVisible();
  const categories = await page.goto("/categories");
  expect(categories?.status()).toBe(200);
  await expect(
    page.getByRole("heading", { level: 1, name: "الأقسام" }),
  ).toBeVisible();
  const favorites = await page.goto("/favorites");
  expect(favorites?.status()).toBe(200);
  await expect(
    page.getByRole("heading", { level: 1, name: "المفضلة" }),
  ).toBeVisible();
  const account = await page.goto("/account");
  expect(account?.status()).toBe(200);
  await expect(page.getByRole("link", { name: "متابعة كضيف" })).toBeVisible();
});

test("home: compact header, today's category, category cards, new arrivals and no delivery strip", async ({
  page,
}) => {
  const issues = trackPageIssues(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  const brand = page.locator("header .brand");
  const language = page.locator("header .header-language");
  const search = page.getByRole("searchbox", { name: "ابحث في المنتجات" });
  const [brandBox, languageBox, searchBox] = await Promise.all([
    brand.boundingBox(),
    language.boundingBox(),
    search.boundingBox(),
  ]);
  // Language and logo on one row, the search under them across the page.
  expect(
    Math.abs(
      brandBox!.y +
        brandBox!.height / 2 -
        (languageBox!.y + languageBox!.height / 2),
    ),
  ).toBeLessThan(12);
  expect(searchBox!.y).toBeGreaterThan(brandBox!.y + brandBox!.height - 1);
  expect(searchBox!.width).toBeGreaterThan(300);
  await expect(page.locator("header .cart-button")).toBeHidden();

  const banner = page.locator(".daily-category");
  await expect(banner).toBeVisible();
  await expect(banner.getByText("قسم اليوم")).toBeVisible();
  const code = await banner.getAttribute("data-category-id");
  expect(code).toBeTruthy();
  await expect(banner.getByRole("link", { name: /^تسوّق/ })).toHaveAttribute(
    "href",
    `/categories/${code}`,
  );
  // Same category on a reload: it changes with the store day only.
  await page.reload();
  await expect(page.locator(".daily-category")).toHaveAttribute(
    "data-category-id",
    code!,
  );

  const cards = page.locator(".categories-section a.category-item");
  expect(await cards.count()).toBeGreaterThan(0);
  for (const href of await cards.evaluateAll((items) =>
    items.map((item) => item.getAttribute("href")),
  )) {
    expect(href).toMatch(/^\/categories\/[a-z0-9-]+$/);
  }
  await expect(
    page.getByRole("link", { name: "كل الأقسام" }).first(),
  ).toHaveAttribute("href", "/categories");
  await expect(
    page.getByRole("heading", { level: 2, name: "وصل حديثًا" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "عرض الكل" })).toHaveAttribute(
    "href",
    "/products",
  );
  await expect(
    page.getByRole("combobox", { name: "ترتيب المنتجات" }),
  ).toHaveValue("newest");

  // Removed from the home page; delivery rules still apply in cart and checkout.
  await expect(page.getByText("توصيل داخل ميثلون")).toHaveCount(0);
  await expect(page.locator(".store-benefits")).toHaveCount(0);

  // The last card's action stays above the bottom bar, and the page ends on the footer.
  const finalAction = page
    .locator(".product-card")
    .last()
    .locator(".product-actions");
  await page.evaluate(() =>
    window.scrollTo({ top: document.documentElement.scrollHeight }),
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
  const actionBox = await finalAction.boundingBox();
  const navigationBox = await page.locator(".mobile-navigation").boundingBox();
  expect(actionBox!.y + actionBox!.height).toBeLessThanOrEqual(
    navigationBox!.y,
  );
  const spacing = await page.evaluate(() => ({
    token: getComputedStyle(document.documentElement)
      .getPropertyValue("--mobile-nav-height")
      .trim(),
    footerPadding: Number.parseFloat(
      getComputedStyle(document.querySelector(".store-footer")!).paddingBottom,
    ),
    navigationHeight: document
      .querySelector(".mobile-navigation")!
      .getBoundingClientRect().height,
  }));
  expect(spacing.token).toBe("4.25rem");
  expect(spacing.footerPadding).toBeGreaterThanOrEqual(
    spacing.navigationHeight - 1,
  );
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
    for (const route of ["/", "/products"]) {
      await page.goto(route);
      await expect(page.getByRole("heading", { level: 1 })).toBeAttached();
      await expect(page.locator(".product-card").first()).toBeVisible();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(overflow).toBeLessThanOrEqual(1);
    }
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

  // Right to left: the language switch, then the logo, then the search.
  await page.keyboard.press("Tab");
  await expect(page.locator(".header-language")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: /^MAYTHA MARKET\s?، الرئيسية$/ }),
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

  // Next comes today's category.
  await page.keyboard.press("Tab");
  const focused = page.locator(":focus");
  await expect(focused).toHaveText(/^تسوّق|كل الأقسام/);
  expect(
    await focused.evaluate((el) => getComputedStyle(el).outlineStyle),
  ).not.toBe("none");
});

test("product cards add to the cart, then change quantity in place", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const card = page
    .locator(".product-card")
    .filter({ hasText: "منظف عام Secret" });

  await card.getByRole("button", { name: "أضف للسلة" }).click();
  await card
    .getByRole("button", { name: "زيادة كمية منظف عام Secret" })
    .click();
  await expect(card.locator(".card-quantity output")).toHaveText("2");
  await expect(cartCount(page)).toHaveText("2");

  await card
    .getByRole("button", { name: "تقليل كمية منظف عام Secret" })
    .click();
  await card
    .getByRole("button", { name: "إزالة منظف عام Secret من السلة" })
    .click();
  await expect(card.getByRole("button", { name: "أضف للسلة" })).toBeVisible();
  await expect(cartCount(page)).toHaveCount(0);

  // The heart saves to the wishlist without touching the cart.
  const heart = card.getByRole("button", {
    name: "إضافة منظف عام Secret إلى المفضلة",
  });
  await heart.click();
  await expect(
    card.getByRole("button", { name: "إزالة منظف عام Secret من المفضلة" }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.goto("/favorites");
  await expect(
    page.locator("article").filter({ hasText: "منظف عام Secret" }),
  ).toBeVisible();
});

test("back from a product restores the list, its sort and the scroll position", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/products?sort=price-asc");
  await expect(
    page.getByRole("combobox", { name: "ترتيب المنتجات" }),
  ).toHaveValue("price-asc");
  const last = page.locator(".product-card").last();
  await last.scrollIntoViewIfNeeded();
  const before = await page.evaluate(() => window.scrollY);
  expect(before).toBeGreaterThan(100);
  await last.locator(".product-card-link").click();
  await expect(page).toHaveURL(/\/products\/[a-z0-9-]+$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/products\?sort=price-asc$/);
  await expect(
    page.getByRole("combobox", { name: "ترتيب المنتجات" }),
  ).toHaveValue("price-asc");
  await expect
    .poll(() => page.evaluate(() => window.scrollY))
    .toBeGreaterThan(before - 80);
});

test("bottom navigation: Home, Categories, Wishlist, Cart, 44px targets, current page marked", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/categories");
  const links = page.locator(".mobile-navigation a");
  await expect(links).toHaveCount(4);
  expect(
    await links.evaluateAll((items) =>
      items.map((item) => item.getAttribute("href")),
    ),
  ).toEqual(["/", "/categories", "/favorites", "/cart"]);
  for (const box of await links.evaluateAll((items) =>
    items.map((item) => item.getBoundingClientRect().toJSON()),
  )) {
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
  await expect(
    page.locator('.mobile-navigation a[href="/categories"]'),
  ).toHaveAttribute("aria-current", "page");
  await expect(
    page.locator(".mobile-navigation").getByRole("link", { name: "العروض" }),
  ).toHaveCount(0);
});
