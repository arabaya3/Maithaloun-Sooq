import { expect, test } from "@playwright/test";

import {
  dispatchInstallPrompt,
  expectNoHorizontalOverflow,
  login,
  trackPageIssues,
} from "./support";

const ATTRIBUTION = "بإدارة المهندس عايد ربايعة";
const viewports = [
  { width: 360, height: 800 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1440, height: 900 },
];

test("manifest, favicon and Apple touch icon serve the new logo set", async ({
  page,
  request,
}) => {
  const response = await request.get("/manifest.webmanifest");
  expect(response.status()).toBe(200);
  const manifest = await response.json();
  expect(manifest.name).toBe("سوق ميثلون");
  expect(manifest.short_name).toBe("ميثلون");
  expect(manifest.dir).toBe("rtl");
  expect(manifest.lang).toBe("ar");
  expect(manifest.display).toBe("standalone");
  expect(JSON.stringify(manifest)).not.toContain("/icons/icon-");

  await page.goto("/");
  const links = await page
    .locator('link[rel="icon"], link[rel="apple-touch-icon"]')
    .evaluateAll((nodes) =>
      nodes.map((node) => (node as HTMLLinkElement).getAttribute("href")!),
    );
  expect(links).toEqual(
    expect.arrayContaining([
      "/brand/app/favicon-16-v2.png",
      "/brand/app/favicon-32-v2.png",
      "/brand/app/apple-touch-icon-v2.png",
    ]),
  );
  expect(links.join(" ")).not.toContain("/icons/icon-");

  const sources = [
    ...manifest.icons.map((icon: { src: string }) => icon.src),
    ...links.filter((href) => href.startsWith("/brand/")),
  ];
  for (const src of new Set(sources)) {
    const icon = await request.get(src);
    expect(icon.status(), src).toBe(200);
    expect(icon.headers()["content-type"]).toBe("image/png");
  }
  expect((await request.get("/favicon.ico")).status()).toBe(200);
  expect((await request.get("/icons/icon-192.png")).status()).toBe(404);
});

for (const viewport of viewports) {
  test(`footer attribution renders once without overflow at ${viewport.width}x${viewport.height}`, async ({
    page,
  }) => {
    const issues = trackPageIssues(page);
    await page.setViewportSize(viewport);
    for (const path of ["/", "/products/general-cleaner-secret", "/cart"]) {
      await page.goto(path);
      const footer = page.getByRole("contentinfo");
      await expect(footer).toHaveCount(1);
      await expect(page.getByText(ATTRIBUTION, { exact: true })).toHaveCount(1);
      await expect(
        footer.getByText(ATTRIBUTION, { exact: true }),
      ).toBeVisible();
      await expectNoHorizontalOverflow(page);
    }
    if (viewport.width === 360) {
      await page.goto("/");
      await dispatchInstallPrompt(page);
      await expect(
        page.getByRole("complementary", { name: "ثبّت سوق ميثلون" }),
      ).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await page.screenshot({
        path: "artifacts/pwa-branding/install-banner-360.png",
      });
    }
    if (viewport.width === 390) {
      await page.goto("/");
      await page.getByRole("contentinfo").scrollIntoViewIfNeeded();
      await page.screenshot({
        path: "artifacts/pwa-branding/footer-mobile-390.png",
      });
    }
    expect(issues.consoleErrors).toEqual([]);
    expect(issues.failedRequests).toEqual([]);
  });
}

test("standalone mode hides the install banner and keeps the footer", async ({
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
            addEventListener: () => undefined,
            removeEventListener: () => undefined,
          } as MediaQueryList)
        : original(query);
  });
  await page.goto("/");
  await dispatchInstallPrompt(page);
  await expect(
    page.getByRole("complementary", { name: "ثبّت سوق ميثلون" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("contentinfo").getByText(ATTRIBUTION, { exact: true }),
  ).toBeVisible();
});

test("admin keeps its own branding and has no storefront footer", async ({
  page,
}) => {
  await login(page);
  await expect(page.getByText(ATTRIBUTION)).toHaveCount(0);
  await expect(page.locator(".store-footer")).toHaveCount(0);
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
    "href",
    "/admin-manifest.webmanifest",
  );
});
