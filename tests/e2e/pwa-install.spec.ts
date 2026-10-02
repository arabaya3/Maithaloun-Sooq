import { expect, test } from "@playwright/test";

import {
  IPHONE_USER_AGENT,
  dispatchInstallPrompt,
  expectNoHorizontalOverflow,
  login,
  trackPageIssues,
} from "./support";

const storefrontAction = { name: "تثبيت التطبيق", exact: true };
const adminAction = /ثبّتي تطبيق الإدارة على الجهاز/;

test("storefront install banner appears, installs and remembers dismissal", async ({
  page,
}) => {
  const issues = trackPageIssues(page);
  await page.goto("/");
  await expect(page.getByRole("button", storefrontAction)).toHaveCount(0);

  await dispatchInstallPrompt(page);
  const banner = page.getByRole("complementary", { name: "ثبّت سوق ميثلون" });
  await expect(banner).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await expect(banner.locator("img")).toHaveAttribute(
    "src",
    /maithaloun-symbol.png/,
  );
  await page.screenshot({
    path: "artifacts/store-ops/install-storefront-android-390.png",
  });

  // The banner must not cover the bottom navigation or the first product action.
  const navBox = await page.locator(".mobile-navigation").boundingBox();
  const bannerBox = await banner.boundingBox();
  expect(bannerBox!.y + bannerBox!.height).toBeLessThanOrEqual(navBox!.y);

  await page.getByRole("button", { name: "لاحقاً" }).click();
  await expect(banner).toHaveCount(0);

  await page.reload();
  await dispatchInstallPrompt(page);
  await expect(page.getByRole("button", storefrontAction)).toHaveCount(0);

  await page.goto("/account");
  await page.getByRole("button", { name: "تثبيت التطبيق على الهاتف" }).click();
  await expect(
    page.getByRole("dialog", {
      name: "إضافة سوق ميثلون إلى الشاشة الرئيسية",
    }),
  ).toBeVisible();

  expect(issues.consoleErrors).toEqual([]);
  expect(issues.failedRequests).toEqual([]);
});

test("checkout is never covered by the install banner", async ({ page }) => {
  await page.goto("/checkout");
  await dispatchInstallPrompt(page);
  await expect(page.getByRole("button", storefrontAction)).toHaveCount(0);
});

test.describe("iPhone", () => {
  test.use({ userAgent: IPHONE_USER_AGENT });

  test("storefront explains the manual iOS steps", async ({ page }) => {
    await page.goto("/");
    const action = page.getByRole("button", storefrontAction);
    await action.click();
    const sheet = page.getByRole("dialog", {
      name: "إضافة سوق ميثلون إلى الشاشة الرئيسية",
    });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole("listitem")).toHaveCount(3);
    await page.screenshot({
      path: "artifacts/store-ops/install-ios-instructions-390.png",
    });

    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    await expect(action).toBeFocused();
  });

  test("admin home offers the install action with Arabic steps", async ({
    page,
  }) => {
    await login(page);
    await page.getByRole("button", { name: adminAction }).click();
    const sheet = page.getByRole("dialog", { name: "تثبيت تطبيق الإدارة" });
    await expect(sheet.getByText("افتحي زر المشاركة.")).toBeVisible();
    await expect(
      sheet.getByText("اختاري “إضافة إلى الشاشة الرئيسية”."),
    ).toBeVisible();
    await expect(sheet.getByText("اضغطي “إضافة”.")).toBeVisible();
    await page.screenshot({
      path: "artifacts/store-ops/install-admin-ios-390.png",
    });
  });
});

test("manifests separate the storefront and the admin app", async ({
  page,
  request,
}) => {
  const storefront = await request.get("/manifest.webmanifest");
  expect(storefront.ok()).toBe(true);
  expect((await storefront.json()).start_url).toBe("/");

  const adminManifest = await request.get("/admin-manifest.webmanifest");
  expect(adminManifest.ok()).toBe(true);
  const body = await adminManifest.json();
  expect(body.start_url).toBe("/admin");
  expect(body.scope).toBe("/admin");
  expect(body.display).toBe("standalone");

  await page.goto("/admin/login");
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
    "href",
    "/admin-manifest.webmanifest",
  );
  const response = await page.goto("/admin/login");
  // next dev rewrites Cache-Control; production sends no-store from the proxy.
  expect(response?.headers()["cache-control"]).toMatch(/no-store|no-cache/);
  expect(response?.headers()["x-robots-tag"]).toMatch(/noindex/);
});
