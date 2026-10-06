import { expect, test } from "@playwright/test";
import sharp from "sharp";

import {
  expectNoHorizontalOverflow,
  login,
  trackPageIssues,
  withTestDb,
} from "./support";

const SHOTS = "artifacts/store-ops";

async function invoicePhoto(): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800">
    <rect width="600" height="800" fill="#ffffff"/>
    <rect x="40" y="40" width="520" height="90" fill="#e7f0eb"/>
    <rect x="40" y="170" width="520" height="28" fill="#d9dedb"/>
    <rect x="40" y="220" width="520" height="28" fill="#eceeec"/>
    <rect x="40" y="270" width="520" height="28" fill="#eceeec"/>
    <rect x="320" y="700" width="240" height="40" fill="#174e3b"/>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function movementCount() {
  const rows = await withTestDb(
    (sql) => sql<{ total: number }[]>`
      select count(*)::int as total from stock_movements
    `,
  );
  return rows[0]!.total;
}

test("operator photographs an invoice, reviews the reading and confirms it", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const issues = trackPageIssues(page);
  await login(page);

  await page
    .locator(".admin-mobile-header")
    .getByRole("button", { name: "إضافة" })
    .click();
  await page
    .getByRole("dialog", { name: "ماذا تريدين أن تضيفي؟" })
    .getByRole("link", { name: /تصوير فاتورة شراء/ })
    .click();
  await expect(
    page.getByRole("heading", { name: "تصوير فاتورة شراء", level: 1 }),
  ).toBeVisible();
  const read = page.getByRole("button", { name: "قراءة الفاتورة" });
  await expect(read).toBeDisabled();
  await page.screenshot({ path: `${SHOTS}/invoice-capture-empty-390.png` });

  await page.getByLabel("اختيار صور الفاتورة").setInputFiles({
    name: "invoice.png",
    mimeType: "image/png",
    buffer: await invoicePhoto(),
  });
  const pages = page.getByRole("list", { name: "صفحات الفاتورة" });
  await expect(pages.getByRole("listitem")).toHaveCount(1);
  await page.getByRole("button", { name: "تدوير الصفحة 1" }).click();
  await expect(pages.getByRole("img", { name: "الصفحة 1" })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({
    path: `${SHOTS}/invoice-capture-390.png`,
    fullPage: true,
  });

  const before = await movementCount();
  await read.click();
  await expect(
    page.getByRole("heading", { name: "مراجعة قبل الحفظ", level: 1 }),
  ).toBeVisible({ timeout: 30_000 });

  // The original image is shown next to the extracted data and served privately.
  const original = page.getByRole("img", { name: "صفحة الفاتورة 1" });
  await expect(original).toBeVisible();
  const documentResponse = await page.request.get(
    (await original.getAttribute("src"))!,
  );
  expect(documentResponse.ok()).toBe(true);
  expect(documentResponse.headers()["cache-control"]).toContain("no-store");

  await expect(page.getByRole("combobox", { name: "المورد" })).toHaveValue(
    "__new__",
  );
  await expect(page.getByLabel("اسم المورد الجديد")).toHaveValue(
    "مورد النظافة",
  );
  await expect(page.getByLabel("رقم الفاتورة (اختياري)")).toHaveValue("F-2041");
  await expect(
    page.getByRole("button", { name: /منتج السطر 1: سائل جلي Arar/ }),
  ).toBeVisible();
  expect(await movementCount()).toBe(before);
  await expectNoHorizontalOverflow(page);
  await page.screenshot({
    path: `${SHOTS}/invoice-review-390.png`,
    fullPage: true,
  });

  // Line 2 is a fuzzy suggestion; line 3 was barely legible and has no match.
  await page
    .getByRole("group", { name: "اقتراحات السطر 2" })
    .getByRole("button", { name: /منظف أرضيات Smart/ })
    .click();
  await page.getByRole("button", { name: /منتج السطر 3/ }).click();
  const picker = page.getByRole("dialog", { name: "منتج السطر 3" });
  await picker.getByText("منتج جديد").click();
  await expect(picker.getByLabel("اسم المنتج")).toHaveValue("كلور ٤ لتر 4 لتر");
  await picker.getByLabel("اسم المنتج").fill("كلور 4 لتر");
  await picker.getByLabel("سعر البيع للزبون ₪").fill("9");
  await picker.getByRole("button", { name: "إنشاء المنتج واختياره" }).click();
  await expect(
    page.getByRole("button", { name: /منتج السطر 3: كلور 4 لتر/ }),
  ).toBeVisible();

  await page.getByRole("button", { name: "مراجعة الفاتورة" }).click();
  await expect(
    page.getByRole("heading", { name: "راجعي قبل الحفظ" }),
  ).toBeVisible();
  // 102 + 42 + 24 = 168 while the printed total says 170.
  await expect(
    page.getByText(/المجموع المحسوب يختلف عن المطبوع/),
  ).toBeVisible();
  await page.screenshot({
    path: `${SHOTS}/invoice-confirm-390.png`,
    fullPage: true,
  });
  expect(await movementCount()).toBe(before);

  await page.getByRole("button", { name: "تأكيد وحفظ في المخزون" }).click();
  await expect(
    page.getByRole("heading", { name: "تقرير الإدخال", level: 1 }),
  ).toBeVisible({ timeout: 20_000 });
  expect(await movementCount()).toBe(before + 3);

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/admin/inventory/purchases");
  await expect(page.getByText("مورد النظافة").first()).toBeVisible();

  expect(issues.consoleErrors).toEqual([]);
  expect(issues.failedRequests).toEqual([]);
});

test("a file that is not an image is refused with a retry option", async ({
  page,
}) => {
  await login(page);
  await page.goto("/admin/inventory/capture");
  await page.getByLabel("اختيار صور الفاتورة").setInputFiles({
    name: "invoice.jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.from("not really an image"),
  });
  await page.getByRole("button", { name: "قراءة الفاتورة" }).click();
  await expect(page.getByText(/نوع الملف غير مدعوم/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "إعادة المحاولة" }),
  ).toBeEnabled();
});

async function largePage(): Promise<Buffer> {
  const size = 1_500;
  const noise = Buffer.alloc(size * size * 3);
  for (let index = 0; index < noise.length; index += 1) {
    noise[index] = (index * 2_654_435_761) >>> 24;
  }
  for (let index = 0; index < noise.length; index += 7) {
    noise[index] = Math.floor(Math.random() * 256);
  }
  return sharp(noise, { raw: { width: size, height: size, channels: 3 } })
    .png({ compressionLevel: 0 })
    .toBuffer();
}

test("two large PNG pages are shrunk to fit one request and reach review", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await login(page);
  await page.goto("/admin/inventory/capture");
  const first = await largePage();
  const second = await largePage();
  // Together these exceed the platform's 4.5MB body limit.
  expect(first.length + second.length).toBeGreaterThan(5_000_000);
  await page.getByLabel("اختيار صور الفاتورة").setInputFiles([
    { name: "page-1.png", mimeType: "image/png", buffer: first },
    { name: "page-2.png", mimeType: "image/png", buffer: second },
  ]);
  await expect(
    page.getByRole("list", { name: "صفحات الفاتورة" }).getByRole("listitem"),
  ).toHaveCount(2);

  const upload = page.waitForRequest(
    (request) =>
      request.method() === "POST" &&
      request.url().endsWith("/admin/api/invoices"),
  );
  await page.getByRole("button", { name: "قراءة الفاتورة" }).click();
  const sent = Number((await (await upload).allHeaders())["content-length"]);
  expect(sent).toBeGreaterThan(0);
  expect(sent).toBeLessThan(4_000_000);
  await expect(
    page.getByRole("heading", { name: "مراجعة قبل الحفظ", level: 1 }),
  ).toBeVisible({ timeout: 45_000 });
  await expect(
    page.getByRole("img", { name: "صفحة الفاتورة 2" }),
  ).toBeVisible();
});

test("failures are named precisely and keep the previews", async ({ page }) => {
  await login(page);
  await page.goto("/admin/inventory/capture");
  await page.getByLabel("اختيار صور الفاتورة").setInputFiles([
    { name: "a.png", mimeType: "image/png", buffer: await invoicePhoto() },
    { name: "b.png", mimeType: "image/png", buffer: await invoicePhoto() },
  ]);
  const previews = page
    .getByRole("list", { name: "صفحات الفاتورة" })
    .getByRole("img");
  await expect(previews).toHaveCount(2);

  await page.route("**/admin/api/invoices", (route) => route.abort("failed"));
  await page.getByRole("button", { name: "قراءة الفاتورة" }).click();
  await expect(page.locator("p.admin-form-error")).toContainText(
    "تعذّر الوصول إلى الخادم",
  );
  await expect(previews).toHaveCount(2);

  await page.unroute("**/admin/api/invoices");
  await page.route("**/admin/api/invoices", (route) =>
    route.fulfill({
      status: 413,
      contentType: "text/plain",
      body: "Request Entity Too Large",
    }),
  );
  await page.getByRole("button", { name: "إعادة المحاولة" }).click();
  await expect(page.locator("p.admin-form-error")).toContainText(
    "حجم الصور أكبر",
  );
  await expect(previews).toHaveCount(2);

  await page.unroute("**/admin/api/invoices");
  await page.route("**/admin/api/invoices", (route) =>
    route.fulfill({
      status: 502,
      contentType: "application/json",
      body: JSON.stringify({
        ok: false,
        message:
          "تعذّرت قراءة الفاتورة آلياً. الصور محفوظة؛ أعيدي المحاولة أو أدخليها يدوياً.",
      }),
    }),
  );
  await page.getByRole("button", { name: "إعادة المحاولة" }).click();
  await expect(page.locator("p.admin-form-error")).toContainText(
    "تعذّرت قراءة الفاتورة آلياً",
  );
  await expect(previews).toHaveCount(2);
  await expect(
    page.getByRole("button", { name: "إعادة المحاولة" }),
  ).toBeEnabled();
});
