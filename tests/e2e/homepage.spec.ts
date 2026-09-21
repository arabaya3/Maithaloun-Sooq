import { expect, test } from "@playwright/test";

test("homepage search, filtering, and cart work in RTL", async ({ page }) => {
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
  await expect(
    page.getByRole("button", { name: "السلة، منتج واحد" }),
  ).toBeVisible();

  await search.clear();
  await page.getByRole("button", { name: "منظفات المطبخ" }).click();
  await expect(page.getByText("سائل جلي Arar")).toBeVisible();
  await expect(page.getByText("مبيض Dolphin")).toBeHidden();

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
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

for (const viewport of [
  { width: 360, height: 800 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1440, height: 900 },
]) {
  test(`has no horizontal overflow at ${viewport.width}x${viewport.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });
}
