import { expect, test } from "@playwright/test";

// Read-only: these pages are opened and photographed; nothing is ordered or changed.
// A full-page capture draws the fixed bottom navigation once, mid-page, where it never sits for a
// visitor. So the bar is left out of full-page captures (stylePath applies to the capture only) and
// checked where it really is in a separate phone viewport capture.
const pages = [
  ["home-ar", "/"],
  ["home-en", "/en"],
] as const;

for (const [name, path] of pages) {
  test(`${name} full page matches its baseline`, async ({ page }) => {
    await page.goto(path);
    await expect(page.locator("main")).toBeVisible();
    await expect(page).toHaveScreenshot(`${name}.png`, {
      fullPage: true,
      stylePath: "tests/visual/hide-fixed-navigation.css",
    });
  });

  test(`${name} phone viewport with its navigation matches its baseline`, async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "visual-mobile", "phone only");
    await page.goto(path);
    await expect(page.locator(".mobile-navigation")).toBeVisible();
    await expect(page).toHaveScreenshot(`${name}-viewport.png`);
  });
}
