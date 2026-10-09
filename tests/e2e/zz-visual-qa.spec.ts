import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import {
  expectNoHorizontalOverflow,
  login,
  trackPageIssues,
  withTestDb,
} from "./support";

// Runs last on purpose: the record pages below open what earlier specs created.
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

// Accessibility is checked at one phone and one desktop width; layout at every width.
const AXE_AT = new Set(["390", "1440"]);

const staticPages = [
  { slug: "home", path: "/admin" },
  { slug: "orders", path: "/admin/orders" },
  { slug: "orders-qa", path: "/admin/orders/qa" },
  { slug: "sales", path: "/admin/sales" },
  { slug: "sale-new", path: "/admin/sales/new" },
  { slug: "customers", path: "/admin/customers" },
  { slug: "inventory", path: "/admin/inventory" },
  { slug: "stock", path: "/admin/inventory/stock" },
  { slug: "purchases", path: "/admin/inventory/purchases" },
  { slug: "purchase-new", path: "/admin/inventory/purchases/new" },
  { slug: "capture", path: "/admin/inventory/capture" },
  { slug: "import", path: "/admin/inventory/import" },
  { slug: "price-reviews", path: "/admin/inventory/price-reviews" },
  { slug: "suppliers", path: "/admin/inventory/suppliers" },
  { slug: "products", path: "/admin/products" },
  { slug: "product-new", path: "/admin/products/new" },

  { slug: "product-photo", path: "/admin/products/new/photo" },
  { slug: "categories", path: "/admin/categories" },
  { slug: "offers", path: "/admin/offers" },
  { slug: "offer-new", path: "/admin/offers/new" },
  { slug: "reports", path: "/admin/reports" },
  { slug: "reports-archive", path: "/admin/reports/archive" },
  { slug: "voice", path: "/admin/voice" },
  { slug: "notifications", path: "/admin/notifications" },
  { slug: "settings", path: "/admin/settings" },
  { slug: "users", path: "/admin/settings/users" },
  { slug: "audit", path: "/admin/audit" },
];

let pages: Array<{ slug: string; path: string }> = staticPages;

// One record of each kind, read from what earlier specs left in the test database.
test.beforeAll(async () => {
  const rows = await withTestDb(
    (sql) => sql<{ slug: string; path: string | null }[]>`
      select 'order' as slug, (select '/admin/orders/' || public_reference from orders order by created_at desc limit 1) as path
      union all select 'sale', (select '/admin/sales/' || id from customer_invoices order by created_at desc limit 1)
      union all select 'customer', (select '/admin/customers/' || id from customers order by created_at desc limit 1)
      union all select 'product', '/admin/products/general-cleaner'
      union all select 'stock-item', (select '/admin/inventory/stock/' || v.domain_id from inventory_items i join product_variants v on v.id = i.variant_id limit 1)
      union all select 'purchase', (select '/admin/inventory/purchases/' || id from purchase_invoices order by created_at desc limit 1)
      union all select 'supplier', (select '/admin/inventory/suppliers/' || id from suppliers order by created_at desc limit 1)
      union all select 'offer', (select '/admin/offers/' || id from offers order by created_at desc limit 1)
    `,
  );
  const found = rows.flatMap((row) =>
    row.path ? [{ slug: row.slug, path: row.path }] : [],
  );
  // Every kind must exist; a missing one means an earlier spec stopped early, which is a failure here too.
  expect(found.map((row) => row.slug)).toEqual([
    "order",
    "sale",
    "customer",
    "product",
    "stock-item",
    "purchase",
    "supplier",
    "offer",
  ]);
  pages = [...staticPages, ...found];
});

async function undersizedTargets(page: Page) {
  return page.evaluate(() =>
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
}

for (const viewport of viewports) {
  test(`every admin screen fits ${viewport.name} with 44px targets${AXE_AT.has(viewport.name) ? " and passes axe" : ""}`, async ({
    page,
  }) => {
    test.setTimeout(300_000);
    const issues = trackPageIssues(page);
    await login(page);
    await page.setViewportSize(viewport);
    const small: string[] = [];
    const violations: string[] = [];

    for (const target of pages) {
      await page.goto(target.path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expectNoHorizontalOverflow(page);
      for (const entry of await undersizedTargets(page)) {
        small.push(`${target.path}: ${entry}`);
      }
      if (AXE_AT.has(viewport.name)) {
        const result = await new AxeBuilder({ page })
          .include("main")
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
          .analyze();
        for (const violation of result.violations) {
          violations.push(
            `${target.path}: ${violation.id} ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`,
          );
        }
      }
      await page.screenshot({
        path: `${SHOTS}/qa/${target.slug}-${viewport.name}.png`,
        fullPage: true,
      });
    }

    expect([...new Set(small)]).toEqual([]);
    expect(violations).toEqual([]);
    expect(issues.consoleErrors).toEqual([]);
    expect(issues.failedRequests).toEqual([]);
  });
}
