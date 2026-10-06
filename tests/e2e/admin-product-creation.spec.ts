import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import {
  expectNoHorizontalOverflow,
  login,
  trackPageIssues,
  withTestDb,
} from "./support";

const SHOTS = "artifacts/admin-product-creation";
const WIDTHS = [
  [360, 800],
  [390, 844],
  [768, 1024],
  [1440, 900],
] as const;
const NAME = "منتج تجربة الإنشاء";

test.describe.configure({ mode: "serial" });

let domainId = "";

test.afterAll(async () => {
  await withTestDb((sql) => sql`delete from products where name_ar = ${NAME}`);
});

async function axe(page: Page, selector: string) {
  const result = await new AxeBuilder({ page })
    .include(selector)
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(
    result.violations.map((violation) => ({
      id: violation.id,
      nodes: violation.nodes.map((node) => node.target.join(" ")),
    })),
  ).toEqual([]);
}

async function smallTargets(page: Page, selector: string) {
  return page.locator(selector).evaluateAll((nodes) =>
    nodes
      .filter((node) => (node as HTMLElement).offsetParent !== null)
      .map((node) => {
        const box = node.getBoundingClientRect();
        return { text: node.textContent?.trim(), w: box.width, h: box.height };
      })
      .filter((box) => box.w < 44 || box.h < 44),
  );
}

test("new product: three large routes at 360, 390, 768 and 1440", async ({
  page,
}) => {
  const issues = trackPageIssues(page);
  await login(page);
  for (const [width, height] of WIDTHS) {
    await page.setViewportSize({ width, height });
    await page.goto("/admin/products/new");
    const cards = page.locator(".admin-route-card");
    await expect(cards).toHaveCount(3);
    await expect(cards.nth(0)).toHaveAttribute(
      "href",
      "/admin/products/new/photo",
    );
    await expect(cards.nth(1)).toHaveAttribute(
      "href",
      "/admin/products/new/manual",
    );
    await expect(cards.nth(2)).toHaveAttribute(
      "href",
      "/admin/inventory/capture",
    );
    await expectNoHorizontalOverflow(page);
    expect(await smallTargets(page, ".admin-create-routes a")).toEqual([]);
    await axe(page, ".admin-create-routes");
    await page.screenshot({ path: `${SHOTS}/routes-${width}.png` });
  }
  await page.locator(".admin-route-card").first().click();
  await expect(
    page.getByRole("heading", { name: "إضافة منتج", level: 1 }),
  ).toBeVisible();
  expect(issues.consoleErrors).toEqual([]);
});

test("phone: the manual draft survives a reload, creates a draft product and is cleared", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await page.goto("/admin/products/new/manual");
  await page.locator("#product-name-ar").fill(NAME);
  await page.locator("#product-price").fill("6.00");
  await expect(page.getByText(/حُفظت المسودة على هذا الجهاز/)).toBeVisible();

  // A reload (or a failed save) never loses what was typed.
  await page.reload();
  await expect(page.getByText(/لديك مسودة محفوظة/)).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/draft-offer-390.png` });
  await page.getByRole("button", { name: "استعادة المسودة" }).click();
  await expect(page.locator("#product-name-ar")).toHaveValue(NAME);
  await expect(page.locator("#product-price")).toHaveValue("6.00");

  await page.getByRole("button", { name: "إنشاء المنتج" }).click();
  await expect(page).toHaveURL(/\/admin\/products\/[a-z0-9-]+\?saved=created/, {
    timeout: 15_000,
  });
  domainId = /\/admin\/products\/([a-z0-9-]+)\?/.exec(page.url())![1]!;
  const readiness = page.getByRole("region", { name: "جاهزية المنتج" });
  await expect(readiness).toBeVisible();
  await expect(readiness).toContainText(/من \d مكتملة/);
  await expect(readiness.getByText(/صورة مؤقتة/)).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: `${SHOTS}/readiness-390.png` });

  // The finished draft is not offered again.
  await page.goto("/admin/products/new/manual");
  await expect(page.locator("#product-name-ar")).toBeVisible();
  await expect(page.getByText(/لديك مسودة محفوظة/)).toHaveCount(0);
});

test("phone: publishing follows the server rules; archive and permanent delete are explicit", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await page.goto(`/admin/products/${domainId}#publication`);
  const publication = page.getByRole("region", { name: "حالة النشر" });

  // Without accepting the temporary picture the server refuses, and nothing changes.
  await publication
    .locator('select[name="publication"]')
    .selectOption("published");
  await publication.getByRole("button", { name: "حفظ حالة النشر" }).click();
  await expect(
    publication.getByText(
      "المنتج بدون صورة حقيقية. فعّلي «النشر بصورة مؤقتة» أو أضيفي صورة أولاً.",
    ),
  ).toBeVisible();
  const [still] = await withTestDb(
    (sql) => sql<{ publication: string }[]>`
      select publication from products where domain_id = ${domainId}`,
  );
  expect(still!.publication).toBe("draft");

  await publication
    .locator('select[name="publication"]')
    .selectOption("published");
  await publication.getByLabel(/النشر بصورة مؤقتة/).check();
  await publication.getByRole("button", { name: "حفظ حالة النشر" }).click();
  await expect(page.getByText("تم تحديث حالة النشر.")).toBeVisible();
  await expect(
    page.getByRole("region", { name: "جاهزية المنتج" }),
  ).toContainText("منشور ويظهر للزبائن.");

  // Archive needs a reason and keeps the product restorable.
  const danger = page.getByRole("region", { name: "منطقة الخطر" });
  await danger.getByLabel("سبب الأرشفة").fill("تجربة الأرشفة");
  await danger.getByRole("button", { name: /أرشفة المنتج/ }).click();
  await expect(page.getByText(/تمت أرشفة المنتج/)).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/danger-390.png`, fullPage: true });

  // Nothing references this product, so permanent delete is offered behind the exact name.
  const remove = page
    .getByRole("region", { name: "منطقة الخطر" })
    .getByRole("button", { name: /حذف نهائي/ });
  await expect(remove).toBeDisabled();
  const confirm = page.getByLabel(/للتأكيد اكتبي اسم المنتج/);
  await confirm.fill("منتج تجربة");
  await expect(remove).toBeDisabled();
  await confirm.fill(NAME);
  await remove.click();
  await expect(page).toHaveURL(/\/admin\/products\?deleted=/);
  await expect(page.getByText(`تم حذف «${NAME}» نهائياً.`)).toBeVisible();
  const rows = await withTestDb(
    (sql) => sql`select 1 from products where domain_id = ${domainId}`,
  );
  expect(rows).toHaveLength(0);
});
