import { expect, test } from "@playwright/test";

import { expectNoHorizontalOverflow } from "./support";

// Every width the MAYTHA brief names, in both languages, for the pages a shopper sees.
const widths = [320, 360, 375, 390, 430, 768, 1024, 1440];
const pages = [
  "/",
  "/categories",
  "/products/general-cleaner-secret",
  "/cart",
  "/checkout",
  "/delivery",
];
const SHOTS = "artifacts/design-review";

for (const locale of ["ar", "en"] as const) {
  test(`${locale}: no sideways overflow from 320 to 1440 px`, async ({
    page,
  }) => {
    test.setTimeout(180_000);
    for (const width of widths) {
      await page.setViewportSize({ width, height: width < 768 ? 844 : 900 });
      for (const path of pages) {
        const address =
          locale === "en" ? `/en${path === "/" ? "" : path}` : path;
        await page.goto(address);
        await expect(page.locator("html")).toHaveAttribute("lang", locale);
        await expectNoHorizontalOverflow(page);
        if ((width === 390 || width === 1440) && path !== "/checkout") {
          const name = path === "/" ? "home" : path.split("/")[1];
          await page.screenshot({
            path: `${SHOTS}/${name}-${locale}-${width}.png`,
            fullPage: width === 390,
          });
        }
      }
    }
  });
}
