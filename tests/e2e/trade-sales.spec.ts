import { expect, test, type Page } from "@playwright/test";

import {
  expectNoHorizontalOverflow,
  login,
  trackPageIssues,
  withTestDb,
} from "./support";

const SHOTS = "artifacts/store-ops";
const CUSTOMER = "أحمد التجريبي";

test.describe.configure({ mode: "serial" });

async function pick(page: Page, search: string) {
  await page.getByRole("button", { name: /منتج السطر 1/ }).click();
  const picker = page.getByRole("dialog", { name: "منتج السطر 1" });
  await picker.getByRole("searchbox", { name: "بحث عن منتج" }).fill(search);
  await picker.getByRole("button").filter({ hasText: search }).first().click();
}

async function invoiceCount() {
  const rows = await withTestDb(
    (sql) => sql<{ total: number }[]>`
      select count(*)::int as total from customer_invoices
    `,
  );
  return rows[0]!.total;
}

test("manual credit sale, customer ledger and payment entry", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const issues = trackPageIssues(page);
  await login(page);

  await page
    .locator(".admin-mobile-header")
    .getByRole("button", { name: "إضافة" })
    .click();
  await page
    .getByRole("dialog", { name: "ماذا تريدين أن تضيفي؟" })
    .getByRole("link", { name: /إدخال بيع يدوي/ })
    .click();
  await expect(
    page.getByRole("heading", { name: "بيع يدوي", level: 1 }),
  ).toBeVisible();

  // Arar dish liquid was stocked by the spreadsheet import (6 units at 9 ₪).
  await pick(page, "Arar");
  await expect(page.getByLabel("سعر البيع ₪")).toHaveValue("12.00");
  await page.getByLabel(/^الكمية/).fill("2");

  // Credit is refused until the sale has a named customer.
  await expect(page.getByRole("radio", { name: "على الحساب" })).toBeDisabled();
  await page.getByRole("radio", { name: "زبون جديد" }).check();
  await page.getByLabel("اسم الزبون").fill(CUSTOMER);
  await page.getByRole("radio", { name: "دفع جزء" }).check();
  await page.getByLabel("المبلغ المدفوع ₪").fill("10");
  await expectNoHorizontalOverflow(page);
  await page.screenshot({
    path: `${SHOTS}/manual-sale-390.png`,
    fullPage: true,
  });

  const before = await invoiceCount();
  await page.getByRole("button", { name: "مراجعة البيع" }).click();
  await expect(
    page.getByRole("heading", { name: "تأكيد عملية البيع" }),
  ).toBeVisible();
  const review = page.getByRole("region", { name: "تأكيد عملية البيع" });
  await expect(review).toContainText(CUSTOMER);
  await expect(review).toContainText("(زبون جديد)");
  await expect(review).toContainText("الباقي على الزبون");
  await expect(review).toContainText("ربح تقديري");
  expect(await invoiceCount()).toBe(before);
  await page.screenshot({
    path: `${SHOTS}/manual-sale-review-390.png`,
    fullPage: true,
  });

  await page.getByRole("button", { name: "تأكيد وحفظ البيع" }).click();
  await expect(
    page.getByRole("heading", { name: "تم حفظ البيع" }),
  ).toBeVisible();
  expect(await invoiceCount()).toBe(before + 1);

  await page.getByRole("link", { name: "عرض الفاتورة ومشاركتها" }).click();
  await expect(page.getByRole("heading", { name: /فاتورة رقم/ })).toBeVisible();
  const share = page.getByRole("link", { name: "مشاركة عبر واتساب" });
  await expect(share).toHaveAttribute("href", /^https:\/\/wa\.me\/\?text=/);
  await expect(share).toHaveAttribute("target", "_blank");
  await expect(page.getByRole("button", { name: "طباعة" })).toBeVisible();
  await page.screenshot({
    path: `${SHOTS}/sale-invoice-390.png`,
    fullPage: true,
  });

  await page.getByRole("link", { name: CUSTOMER }).click();
  await expect(
    page.getByRole("heading", { name: CUSTOMER, level: 1 }),
  ).toBeVisible();
  const account = page.getByRole("region", { name: "الحساب" });
  await expect(account).toContainText("14 ₪");
  await expect(page.getByText("مدفوعة جزئياً")).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({
    path: `${SHOTS}/customer-profile-390.png`,
    fullPage: true,
  });

  await page.getByLabel("المبلغ المستلم ₪").fill("99");
  await page.getByRole("button", { name: "تسجيل دفعة" }).click();
  await expect(
    page.getByText("المبلغ أكبر من رصيد الزبون المستحق."),
  ).toBeVisible();
  await page.getByLabel("المبلغ المستلم ₪").fill("14");
  await page.getByRole("button", { name: "تسجيل دفعة" }).click();
  await expect(account).toContainText("0 ₪");
  await expect(page.getByText("مدفوعة", { exact: true })).toBeVisible();

  await page.goto("/admin/customers?filter=owing");
  await expect(
    page.getByRole("link", { name: new RegExp(CUSTOMER) }),
  ).toHaveCount(0);
  await page.goto("/admin/customers");
  await expect(
    page.getByRole("link", { name: new RegExp(CUSTOMER) }),
  ).toBeVisible();
  await page.screenshot({
    path: `${SHOTS}/customers-390.png`,
    fullPage: true,
  });

  expect(issues.consoleErrors).toEqual([]);
  expect(issues.failedRequests).toEqual([]);
});

test("owner corrects a payment and cancels an invoice without deleting history", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await login(page);
  await page.goto("/admin/customers");
  await page.getByRole("link", { name: new RegExp(CUSTOMER) }).click();

  const payments = page.getByRole("region", { name: "الدفعات" });
  await payments
    .getByRole("button", { name: "تصحيح: عكس الدفعة" })
    .first()
    .click();
  await payments.getByLabel("سبب التصحيح").fill("سُجّلت بالخطأ");
  await payments.getByRole("button", { name: "تأكيد عكس الدفعة" }).click();
  await expect(payments.getByText("قيد تصحيح (عكس دفعة)")).toBeVisible();
  await expect(payments.getByText(/تم عكسها/)).toBeVisible();

  await page
    .getByRole("region", { name: "الفواتير" })
    .getByRole("link")
    .first()
    .click();
  await page.getByRole("button", { name: "إلغاء الفاتورة" }).click();
  await page.getByLabel("سبب الإلغاء").fill("أُرجعت البضاعة");
  await page
    .getByRole("button", { name: "تأكيد الإلغاء وإرجاع البضاعة" })
    .click();
  await expect(page.getByText("سبب الإلغاء: أُرجعت البضاعة")).toBeVisible();

  const rows = await withTestDb(
    (sql) => sql<{ status: string; entries: number }[]>`
      select i.status,
        (select count(*)::int from customer_ledger_entries e where e.invoice_id = i.id) as entries
      from customer_invoices i
      order by i.created_at desc
      limit 1
    `,
  );
  expect(rows[0]?.status).toBe("cancelled");
  expect(rows[0]?.entries).toBeGreaterThanOrEqual(3);
});
