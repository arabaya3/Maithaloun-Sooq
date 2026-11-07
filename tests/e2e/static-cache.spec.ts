import { expect, test } from "@playwright/test";

// Storefront pages are served from the static cache; unmatched and scanner addresses never render.

test("scanner probes get a small 404 without rendering a page", async ({
  request,
}) => {
  for (const path of [
    "/wp-admin",
    "/wp-login.php",
    "/xmlrpc.php",
    "/.env",
    "/.git/config",
    "/cgi-bin/luci",
    "/phpmyadmin",
  ]) {
    const response = await request.get(path, { maxRedirects: 0 });
    expect(response.status(), path).toBe(404);
    // The prebuilt static 404 page, never a catalog render.
    expect(await response.text(), path).not.toContain("product-grid");
  }
});

test("unknown addresses get the static bilingual 404", async ({ page }) => {
  const response = await page.goto("/no-such-page/at-all");
  expect(response?.status()).toBe(404);
  await expect(
    page.getByRole("heading", { level: 1, name: "الصفحة غير موجودة" }),
  ).toBeVisible();
});

test("the internal Arabic prefix redirects to the public address", async ({
  request,
}) => {
  const response = await request.get("/ar/offers", { maxRedirects: 0 });
  expect(response.status()).toBe(308);
  expect(new URL(response.headers().location!, "http://x").pathname).toBe(
    "/offers",
  );
});

test("both languages are served with the right lang and dir", async ({
  page,
}) => {
  await page.goto("/offers");
  await expect(page.locator("html")).toHaveAttribute("lang", "ar");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await page.goto("/en/offers");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
});
