import { expect, test } from "@playwright/test";

import { expectNoHorizontalOverflow, login, trackPageIssues } from "./support";

const SHOTS = "artifacts/store-ops";

const viewports = [
  { name: "360", width: 360, height: 800 },
  { name: "390", width: 390, height: 844 },
  { name: "768", width: 768, height: 1024 },
  { name: "1024", width: 1024, height: 768 },
  { name: "1440", width: 1440, height: 900 },
  // 1280×800 at 200% browser zoom lays out as 640×400 CSS pixels.
  { name: "zoom200", width: 640, height: 400 },
  // 360-wide phone with text enlarged: WCAG reflow width.
  { name: "reflow320", width: 320, height: 640 },
];

const pages = [
  { slug: "home", path: "/admin" },
  { slug: "orders", path: "/admin/orders" },
  { slug: "inventory", path: "/admin/inventory" },
  { slug: "stock", path: "/admin/inventory/stock" },
  { slug: "purchase-new", path: "/admin/inventory/purchases/new" },
  { slug: "capture", path: "/admin/inventory/capture" },
  { slug: "import", path: "/admin/inventory/import" },
  { slug: "price-reviews", path: "/admin/inventory/price-reviews" },
  { slug: "sale-new", path: "/admin/sales/new" },
  { slug: "sales", path: "/admin/sales" },
  { slug: "customers", path: "/admin/customers" },
  { slug: "reports", path: "/admin/reports" },
  { slug: "voice", path: "/admin/voice" },
  { slug: "notifications", path: "/admin/notifications" },
  { slug: "settings", path: "/admin/settings" },
];

test("operations screens fit every supported viewport with 44px targets", async ({
  page,
}) => {
  test.setTimeout(600_000);
  const issues = trackPageIssues(page);
  await login(page);
  const small: string[] = [];

  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    for (const target of pages) {
      await page.goto(target.path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expectNoHorizontalOverflow(page);
      const undersized = await page.evaluate(() =>
        [
          ...document.querySelectorAll<HTMLElement>(
            "main button, main a.admin-btn, main input:not([type=hidden]), main select, nav[aria-label='التنقل السفلي'] a, nav[aria-label='التنقل السفلي'] button",
          ),
        ]
          .filter((element) => {
            const box = element.getBoundingClientRect();
            if (!box.width || !box.height) return false;
            if (element.closest(".sr-only")) return false;
            // Radios and checkboxes are sized through their 44px label.
            if (
              element instanceof HTMLInputElement &&
              ["radio", "checkbox", "file"].includes(element.type)
            ) {
              const label = element.closest("label");
              return label ? label.getBoundingClientRect().height < 43.5 : true;
            }
            return box.height < 43.5;
          })
          .map(
            (element) =>
              `${element.tagName.toLowerCase()}.${element.className} "${(element.textContent ?? "").trim().slice(0, 30)}" ${Math.round(element.getBoundingClientRect().height)}px`,
          ),
      );
      for (const entry of undersized) {
        small.push(`${viewport.name} ${target.path}: ${entry}`);
      }
      await page.screenshot({
        path: `${SHOTS}/qa/${target.slug}-${viewport.name}.png`,
        fullPage: true,
      });
    }
  }

  expect([...new Set(small)]).toEqual([]);
  expect(issues.consoleErrors).toEqual([]);
  expect(issues.failedRequests).toEqual([]);
});
