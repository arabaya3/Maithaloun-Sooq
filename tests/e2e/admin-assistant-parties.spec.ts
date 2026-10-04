import { expect, test, type Page } from "@playwright/test";

import {
  expectNoHorizontalOverflow,
  login,
  trackPageIssues,
  withTestDb,
} from "./support";

const CUSTOMER = "سعاد ناصر";
const SUPPLIER = "شركة الأمل للتنظيف";

test.describe.configure({ mode: "serial" });

async function openAssistant(page: Page) {
  await page.getByRole("button", { name: "فتح المساعد" }).click();
  const panel = page.getByRole("dialog", { name: "المساعد" });
  await expect(panel).toBeVisible();
  return panel;
}

async function ask(page: Page, text: string) {
  const panel = page.getByRole("dialog", { name: "المساعد" });
  await panel.getByLabel("رسالتك للمساعد").fill(text);
  await panel.getByRole("button", { name: "إرسال" }).click();
}

async function adjustments() {
  return withTestDb(
    (sql) => sql<{ amount: number }[]>`
      select e.amount_agorot as amount from customer_ledger_entries e
      join customers c on c.id = e.customer_id
      where c.name = ${CUSTOMER} and e.type = 'adjustment'
    `,
  );
}

test.afterAll(async () => {
  await withTestDb(async (sql) => {
    await sql`delete from offers where name_ar like '%مبيض Dolphin%'`;
  });
});

test("mobile: customer, offer, balance adjustment, statement and supplier", async ({
  page,
}) => {
  test.setTimeout(150_000);
  const issues = trackPageIssues(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  const panel = await openAssistant(page);

  await ask(
    page,
    `أضيفي زبون ${CUSTOMER} رقمه 0597778888 عنوانه ميثلون الحي الغربي`,
  );
  const create = panel.getByRole("region", { name: `إضافة زبون: ${CUSTOMER}` });
  await expect(create).toContainText("+970597778888");
  await create.getByRole("button", { name: "تأكيد الإضافة" }).click();
  await expect(create.getByRole("status")).toContainText(
    `تمت إضافة الزبون ${CUSTOMER}`,
  );

  await ask(page, "اعملي عرض خصم 10 بالمية على مبيض Dolphin");
  const offer = panel.getByRole("region", { name: /إضافة عرض/ });
  await expect(offer).toContainText("8 ₪");
  await expect(offer).toContainText("7.2 ₪");
  await expect(offer).toContainText("السعر الأصلي في الكتالوج لا يتغيّر");
  await offer.getByRole("button", { name: "تأكيد العرض" }).click();
  await expect(offer.getByRole("status")).toContainText("تم حفظ العرض");

  await ask(page, `زودي دين ${CUSTOMER} 15 بسبب توصيل خاص`);
  const adjust = panel.getByRole("region", {
    name: `تسوية رصيد زبون: ${CUSTOMER}`,
  });
  await expect(adjust).toContainText("لا يمكن التراجع");
  await expect(
    adjust.locator("ins").filter({ hasText: "15 ₪" }).first(),
  ).toBeVisible();
  await adjust.getByRole("button", { name: "تأكيد التسوية" }).dblclick();
  await expect(adjust.getByRole("status")).toContainText("الرصيد الآن 15 ₪");
  expect(await adjustments()).toEqual([{ amount: 1_500 }]);

  await ask(page, `كشف حساب ${CUSTOMER}`);
  await expect(
    panel.getByRole("list", { name: "كشف الحساب" }).last(),
  ).toContainText("تسوية");

  await ask(page, "كشف حساب سعاد");
  await expect(
    panel
      .getByRole("group", { name: "لقيت أكثر من زبون، أي واحد؟" })
      .or(panel.getByText("الرصيد الختامي"))
      .last(),
  ).toBeVisible();

  await ask(page, `أضيفي مورد ${SUPPLIER}`);
  const supplier = panel.getByRole("region", {
    name: `إضافة مورد: ${SUPPLIER}`,
  });
  await supplier.getByRole("button", { name: "تأكيد الإضافة" }).click();
  await expect(supplier.getByRole("status")).toContainText(
    `تمت إضافة المورد ${SUPPLIER}`,
  );
  await ask(page, `دفعة 5 للمورد ${SUPPLIER}`);
  await expect(
    panel.getByText("المستحق للمورد 0 ₪ فقط.").first(),
  ).toBeVisible();

  await ask(page, `احذفي الزبون ${CUSTOMER} نهائياً`);
  await expect(panel.getByText(/لذلك لا يُحذف نهائياً/).last()).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.goto("/products/dolphin-bleach");
  await expect(
    page.getByLabel("السعر 7.2 ₪ بدلاً من 8 ₪").first(),
  ).toBeVisible();

  expect(issues.consoleErrors).toEqual([]);
  expect(issues.failedRequests).toEqual([]);
});

test("cards and statements fit at 360x800", async ({ page }) => {
  const issues = trackPageIssues(page);
  await page.setViewportSize({ width: 360, height: 800 });
  await login(page);
  const panel = await openAssistant(page);
  // Count only after the saved conversation has been restored into the panel.
  await expect(panel).toHaveAttribute("aria-busy", "false");
  const statements = panel.getByRole("list", { name: "كشف الحساب" });
  const before = await statements.count();
  await ask(page, `كشف حساب ${CUSTOMER}`);
  await expect(statements).toHaveCount(before + 1);
  await expectNoHorizontalOverflow(page);
  expect(issues.consoleErrors).toEqual([]);
  expect(issues.failedRequests).toEqual([]);
});
