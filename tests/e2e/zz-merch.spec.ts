import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import {
  expectNoHorizontalOverflow,
  login,
  trackPageIssues,
  withTestDb,
} from "./support";

// Runs late on purpose: its offers price the general cleaner, and earlier specs check list prices.
const SHOTS = "artifacts/admin-merch";
const CATEGORY_OFFER = "خصم قسم الاختبار";
const PRODUCT_OFFER = "خصم المنظف";
const WIDTHS = [
  [360, 800],
  [390, 844],
  [768, 1024],
  [1440, 900],
] as const;

test.describe.configure({ mode: "serial" });

let offerPath = "";
let categoryName = "";

async function axe(page: Page) {
  const result = await new AxeBuilder({ page })
    .include("main")
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(
    result.violations.map((violation) => ({
      id: violation.id,
      nodes: violation.nodes.map((node) => node.target.join(" ")),
    })),
  ).toEqual([]);
}

async function fillOffer(
  page: Page,
  name: string,
  scope: { category?: string; product?: string },
  percent: string,
) {
  await page.getByLabel("اسم العرض (للإدارة)").fill(name);
  if (scope.category) await page.getByLabel(scope.category).check();
  if (scope.product) {
    await page.getByLabel("بحث في المنتجات").fill(scope.product);
    await page
      .getByRole("checkbox", { name: new RegExp(scope.product) })
      .check();
  }
  await page.getByRole("button", { name: "التالي: السعر" }).click();
  await page.getByRole("radio", { name: "نسبة خصم" }).check();
  await page.getByLabel("نسبة الخصم ٪").fill(percent);
  await page.getByRole("button", { name: "التالي: المدة" }).click();
  await page.getByRole("checkbox", { name: "مفعّل" }).check();
  await page.getByRole("button", { name: "التالي: المعاينة" }).click();
}

test("owner builds an offer in four steps and a clashing one is stopped with its name", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const issues = trackPageIssues(page);
  const [row] = await withTestDb(
    (sql) => sql<{ name: string }[]>`
      select c.name_ar as name from products p
      join product_categories c on c.code = p.category_id
      where p.domain_id = 'general-cleaner'
    `,
  );
  categoryName = row!.name;
  await login(page);
  await page.setViewportSize({ width: 390, height: 844 });

  await page.goto("/admin/offers/new");
  await expect(page.getByRole("list", { name: "خطوات العرض" })).toBeVisible();
  await fillOffer(page, CATEGORY_OFFER, { category: categoryName }, "10");
  await page.getByRole("button", { name: "حساب الأسعار والتعارضات" }).click();
  const prices = page.getByRole("table", { name: "الأسعار في العرض" });
  await expect(prices).toContainText("منظف عام");
  // General cleaner lists at 7 ₪; 10% off is 6.3 ₪.
  await expect(prices).toContainText("6.3 ₪");
  await expect(page.getByText("لا يتعارض مع أي عرض مفعّل.")).toBeVisible();
  await page.screenshot({
    path: `${SHOTS}/offer-preview-390.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "إنشاء العرض" }).click();
  await expect(page).toHaveURL(/\/admin\/offers\/[0-9a-f-]+\?saved=created$/);
  await expect(page.getByText("تم إنشاء العرض.")).toBeVisible();
  offerPath = new URL(page.url()).pathname;

  await page.goto("/admin/offers/new");
  await fillOffer(page, PRODUCT_OFFER, { product: "منظف عام" }, "20");
  await page.getByRole("button", { name: "حساب الأسعار والتعارضات" }).click();
  await expect(page.getByText("يتعارض عند التفعيل مع:")).toBeVisible();
  await expect(page.getByText(new RegExp(`«${CATEGORY_OFFER}»`))).toBeVisible();
  await page.getByRole("button", { name: "إنشاء العرض" }).click();
  await expect(
    page.getByText(
      `يتعارض مع العرض المفعّل «${CATEGORY_OFFER}» على نفس الأصناف في نفس الفترة.`,
    ),
  ).toBeVisible();
  await page.screenshot({
    path: `${SHOTS}/offer-conflict-390.png`,
    fullPage: true,
  });

  // The category the live offer names cannot be merged away from under it.
  await page.goto("/admin/categories");
  const categoryRow = page.getByRole("listitem", {
    name: `القسم ${categoryName}`,
  });
  await categoryRow.getByText("تعديل وإجراءات").click();
  await categoryRow.getByLabel("دمج في قسم آخر").selectOption({ index: 1 });
  await categoryRow.getByRole("button", { name: "دمج القسم" }).click();
  await expect(
    categoryRow.getByText(`العرض «${CATEGORY_OFFER}» مربوط بهذا القسم.`, {
      exact: false,
    }),
  ).toBeVisible();

  await page.goto("/admin/offers");
  const card = page
    .getByRole("list", { name: "قائمة العروض" })
    .getByRole("link", { name: new RegExp(CATEGORY_OFFER) });
  await expect(card).toContainText("فعّال الآن");
  await expect(card).toContainText("خصم 10٪");
  await page.screenshot({ path: `${SHOTS}/offers-390.png` });
  expect(issues.consoleErrors).toEqual([]);
  expect(issues.failedRequests).toEqual([]);
});

test("categories reorder one step at a time", async ({ page }) => {
  const issues = trackPageIssues(page);
  await login(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/admin/categories");
  const rows = page
    .getByRole("list", { name: "الأقسام الحالية" })
    .getByRole("listitem");
  const names = async () =>
    rows.evaluateAll((items) =>
      items.map((item) => item.getAttribute("aria-label")),
    );
  const before = await names();
  await expect(
    page.getByRole("button", {
      name: `تقديم ${before[0]!.replace("القسم ", "")}`,
    }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: `تقديم ${before[1]!.replace("القسم ", "")}` })
    .click();
  await expect(
    page.getByText("تم تغيير ترتيب الأقسام في المتجر."),
  ).toBeVisible();
  expect(await names()).toEqual([before[1], before[0], ...before.slice(2)]);
  // Put it back so the storefront order is as the seed left it.
  await page
    .getByRole("button", { name: `تقديم ${before[0]!.replace("القسم ", "")}` })
    .click();
  await expect.poll(names).toEqual(before);
  await page.screenshot({
    path: `${SHOTS}/categories-390.png`,
    fullPage: true,
  });
  expect(issues.consoleErrors).toEqual([]);
});

test("merchandising pages fit 360 to 1440 and pass axe; the offer is archived after", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const issues = trackPageIssues(page);
  await login(page);
  const pages = [
    ["offers", "/admin/offers"],
    ["offer", offerPath],
    ["offer-new", "/admin/offers/new"],
    ["categories", "/admin/categories"],
  ] as const;
  for (const [width, height] of WIDTHS) {
    await page.setViewportSize({ width, height });
    for (const [key, path] of pages) {
      await page.goto(path);
      await expect(page.locator("main h1")).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await axe(page);
      await page.screenshot({ path: `${SHOTS}/${key}-${width}.png` });
    }
  }
  await page.goto(offerPath);
  await page.getByRole("button", { name: "أرشفة العرض" }).click();
  await expect(page.getByText("تمت أرشفة العرض وإيقافه.")).toBeVisible();
  expect(issues.consoleErrors).toEqual([]);
  expect(issues.failedRequests).toEqual([]);
});
