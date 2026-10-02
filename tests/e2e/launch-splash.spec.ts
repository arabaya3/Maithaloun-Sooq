import { expect, test, type Page } from "@playwright/test";

import { expectNoHorizontalOverflow, login, trackPageIssues } from "./support";

async function observeLayoutShift(page: Page) {
  await page.addInitScript(() => {
    const scope = window as unknown as { __cls: number };
    scope.__cls = 0;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as (PerformanceEntry & {
        value: number;
        hadRecentInput: boolean;
      })[]) {
        if (!entry.hadRecentInput) scope.__cls += entry.value;
      }
    }).observe({ type: "layout-shift", buffered: true });
  });
}

async function layoutShift(page: Page) {
  return page.evaluate(() => (window as unknown as { __cls: number }).__cls);
}

for (const viewport of [
  { width: 360, height: 800 },
  { width: 390, height: 844 },
]) {
  test(`cold launch shows the splash, then a usable storefront at ${viewport.width}x${viewport.height}`, async ({
    page,
  }) => {
    const issues = trackPageIssues(page);
    await observeLayoutShift(page);
    await page.setViewportSize(viewport);
    await page.goto("/", { waitUntil: "commit" });

    const splash = page.getByTestId("launch-splash");
    await expect(splash).toBeVisible();
    await expect(splash.locator(".launch-splash-name")).toHaveText(
      "سوق ميثلون",
    );
    await expect(splash.locator("img")).toHaveAttribute(
      "src",
      /maithaloun-symbol\.png/,
    );
    if (viewport.width === 390) {
      await page.screenshot({
        path: "artifacts/launch-splash/01-initial-390.png",
      });
    }

    await expect(splash).toBeHidden({ timeout: 5_000 });
    await expect(page.locator("html")).toHaveAttribute("data-launch", "ready");

    const product = page.locator('[data-product-id="general-cleaner"]');
    await product.getByRole("button", { name: "أضف إلى السلة" }).click();
    await expect(page.locator(".cart-button")).toContainText("1");
    await expectNoHorizontalOverflow(page);
    expect(await layoutShift(page)).toBe(0);
    if (viewport.width === 390) {
      await page.screenshot({
        path: "artifacts/launch-splash/03-after-exit-390.png",
      });
    }

    expect(issues.consoleErrors).toEqual([]);
    expect(issues.failedRequests).toEqual([]);
  });
}

test("client-side navigation and reloads in the same session skip the splash", async ({
  page,
}) => {
  await page.goto("/");
  const splash = page.getByTestId("launch-splash");
  await expect(splash).toBeHidden({ timeout: 5_000 });

  await page
    .getByRole("link", { name: /منظف عام/ })
    .first()
    .click();
  await expect(page).toHaveURL(/\/products\//);
  await expect(splash).toBeHidden();
  await page.goBack();
  await expect(splash).toBeHidden();

  await page.reload({ waitUntil: "commit" });
  await expect(page.locator("html")).toHaveAttribute("data-launch", "skip");
  await expect(splash).toBeHidden();
});

test.describe("reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("shows a static logo with a short fade", async ({ page }) => {
    await page.goto("/", { waitUntil: "commit" });
    const splash = page.getByTestId("launch-splash");
    await expect(splash).toBeVisible();
    await expect(splash.locator(".launch-splash-bubble").first()).toBeHidden();
    await expect(splash.locator(".launch-splash-shine")).toBeHidden();
    await page.screenshot({
      path: "artifacts/launch-splash/04-reduced-motion-390.png",
    });
    await expect(splash).toBeHidden({ timeout: 5_000 });
  });
});

test("standalone display mode launches with the splash and leaves it", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const original = window.matchMedia.bind(window);
    window.matchMedia = (query: string) =>
      query.includes("display-mode: standalone")
        ? ({
            ...original(query),
            matches: true,
            media: query,
          } as MediaQueryList)
        : original(query);
  });
  await page.goto("/", { waitUntil: "commit" });
  await expect(page.getByTestId("launch-splash")).toBeVisible();
  await expect(page.getByTestId("launch-splash")).toBeHidden({
    timeout: 5_000,
  });
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

test("the splash leaves even when the app never becomes ready", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route(/\/_next\/static\/chunks\/.*\.js/, (route) => route.abort());
  await page.goto("/", { waitUntil: "commit" });
  const splash = page.getByTestId("launch-splash");
  await expect(splash).toBeVisible();
  await page.waitForTimeout(450);
  await page.screenshot({
    path: "artifacts/launch-splash/02-midpoint-390.png",
  });
  await expect(splash).toBeHidden({ timeout: 4_000 });
});

test("admin pages never show the storefront splash", async ({ page }) => {
  await login(page);
  await expect(page.getByTestId("launch-splash")).toHaveCount(0);
});

for (const viewport of [
  { width: 768, height: 1024 },
  { width: 1440, height: 900 },
]) {
  test(`splash fits and exits at ${viewport.width}x${viewport.height}`, async ({
    page,
  }) => {
    const issues = trackPageIssues(page);
    await page.setViewportSize(viewport);
    await page.goto("/", { waitUntil: "commit" });
    await expect(page.getByTestId("launch-splash")).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await expect(page.getByTestId("launch-splash")).toBeHidden({
      timeout: 5_000,
    });
    expect(issues.consoleErrors).toEqual([]);
  });
}
