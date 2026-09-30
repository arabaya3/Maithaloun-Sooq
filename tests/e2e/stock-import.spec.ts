import { expect, test } from "@playwright/test";

import {
  expectNoHorizontalOverflow,
  login,
  trackPageIssues,
  withTestDb,
} from "./support";

const SHOTS = "artifacts/store-ops";

const CSV = [
  "المنتج,الكمية,سعر الوحدة,المورد,رقم الفاتورة",
  "سائل جلي Arar,6,9,مورد الاستيراد,CSV-1",
  "مزيل دهون,2,5,مورد الاستيراد,CSV-1",
  '"=HYPERLINK(""http://x"")",1,1,مورد الاستيراد,CSV-1',
  "بدون كمية,,3,مورد الاستيراد,CSV-1",
  "",
].join("\n");

async function onHand(variantId: string) {
  const rows = await withTestDb(
    (sql) => sql<{ on_hand_milli: number }[]>`
      select i.on_hand_milli
      from inventory_items i
      join product_variants v on v.id = i.variant_id
      where v.domain_id = ${variantId}
    `,
  );
  return rows[0]?.on_hand_milli ?? null;
}

test("owner imports a purchase from a spreadsheet after reviewing every row", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const issues = trackPageIssues(page);
  await login(page);

  await page
    .getByRole("navigation", { name: "التنقل السفلي" })
    .getByRole("button", { name: "إضافة" })
    .click();
  await page
    .getByRole("dialog", { name: "ماذا تريدين أن تضيفي؟" })
    .getByRole("link", { name: /رفع Excel/ })
    .click();
  await expect(
    page.getByRole("heading", { name: "رفع ملف Excel", level: 1 }),
  ).toBeVisible();

  const template = await page.request.get("/admin/api/imports/template");
  expect(template.ok()).toBe(true);
  expect(template.headers()["content-type"]).toContain("spreadsheetml");
  expect(template.headers()["cache-control"]).toContain("no-store");

  // A disguised HTML file is rejected by content, whatever its name says.
  await page.locator("#spreadsheet-file").setInputFiles({
    name: "fake.xlsx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: Buffer.from("<html><table><tr><td>=1+1</td></tr></table></html>"),
  });
  await expect(page.getByText(/^نوع الملف غير مدعوم/)).toBeVisible();

  await page.locator("#spreadsheet-file").setInputFiles({
    name: "فاتورة.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(CSV, "utf8"),
  });
  await expect(
    page.getByRole("heading", { name: "طابقي أعمدة الملف" }),
  ).toBeVisible();
  await expect(page.getByRole("combobox", { name: "اسم المنتج" })).toHaveValue(
    "0",
  );
  await expect(page.getByRole("combobox", { name: "الكمية" })).toHaveValue("1");
  await expectNoHorizontalOverflow(page);
  await page.screenshot({
    path: `${SHOTS}/excel-mapping-390.png`,
    fullPage: true,
  });

  await page
    .getByRole("button", { name: "تحليل الملف ومطابقة المنتجات" })
    .click();
  await expect(
    page.getByRole("heading", { name: "مراجعة قبل الحفظ", level: 1 }),
  ).toBeVisible({ timeout: 20_000 });
  const reviewUrl = page.url();
  await expect(page.getByText("1 فيه خطأ")).toBeVisible();
  await expect(page.getByText("الكمية غير صالحة.")).toBeVisible();
  await expect(
    page.getByRole("link", { name: /تنزيل الصفوف/ }),
  ).toHaveAttribute("href", /\/admin\/api\/imports\/.+\/errors$/);
  expect(await onHand("arar-dish-liquid--default")).toBeNull();
  await page.screenshot({
    path: `${SHOTS}/excel-review-390.png`,
    fullPage: true,
  });

  // The ambiguous row is never pre-selected: the operator must choose.
  const suggestions = page.getByRole("group", { name: "اقتراحات السطر 2" });
  await expect(suggestions).toContainText("اختاري المنتج الصحيح");
  await page.getByRole("button", { name: "مراجعة الفاتورة" }).click();
  await expect(page.getByText("اختاري المنتج.").first()).toBeVisible();
  await suggestions.getByRole("button").first().click();

  // The formula-looking row is shown as plain text and ignored.
  await expect(page.getByText('=HYPERLINK("http://x")')).toBeVisible();
  await page.getByRole("button", { name: "تجاهل السطر 3" }).click();

  await page.getByRole("button", { name: "مراجعة الفاتورة" }).click();
  await expect(
    page.getByRole("heading", { name: "راجعي قبل الحفظ" }),
  ).toBeVisible();
  expect(await onHand("arar-dish-liquid--default")).toBeNull();
  await page.getByRole("button", { name: "تأكيد وحفظ في المخزون" }).click();
  // Confirming refreshes the page into the final import report.
  await expect(
    page.getByRole("heading", { name: "تقرير الإدخال", level: 1 }),
  ).toBeVisible({ timeout: 20_000 });
  expect(await onHand("arar-dish-liquid--default")).toBe(6_000);

  await page.goto(reviewUrl);
  await expect(
    page.getByRole("heading", { name: "تقرير الإدخال", level: 1 }),
  ).toBeVisible();
  await expect(page.getByText("2 أُدخل")).toBeVisible();
  await expect(page.getByText("1 تم تجاهله")).toBeVisible();
  await page.screenshot({
    path: `${SHOTS}/excel-report-390.png`,
    fullPage: true,
  });

  const errors = await page.request.get(
    `${reviewUrl.replace("/admin/inventory/review/", "/admin/api/imports/")}/errors`,
  );
  expect(errors.ok()).toBe(true);
  expect(await errors.text()).toContain("بدون كمية");

  // The rejected upload above is an expected 400.
  expect(
    issues.consoleErrors.filter(
      (message) => !message.includes("status of 400"),
    ),
  ).toEqual([]);
  expect(issues.failedRequests).toEqual([]);
});
