import { expect, test } from "@playwright/test";

import {
  expectNoHorizontalOverflow,
  login,
  trackPageIssues,
  withTestDb,
} from "./support";

const SHOTS = "artifacts/store-ops";

async function invoiceCount() {
  const rows = await withTestDb(
    (sql) => sql<{ total: number }[]>`
      select count(*)::int as total from customer_invoices
    `,
  );
  return rows[0]!.total;
}

test("the transcription endpoint is closed without an admin session", async ({
  request,
}) => {
  const response = await request.post("/admin/api/voice/transcribe", {
    data: Buffer.from("not audio"),
    maxRedirects: 0,
  });
  // Signed-out callers are turned away before the handler: redirect or 401.
  expect([307, 401, 403]).toContain(response.status());
});

test("typed voice command: question, clarification, review and confirmed sale", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const issues = trackPageIssues(page);
  await login(page);

  await page
    .getByRole("navigation", { name: "التنقل السفلي" })
    .getByRole("button", { name: "إضافة" })
    .click();
  await page
    .getByRole("dialog", { name: "ماذا تريدين أن تضيفي؟" })
    .getByRole("link", { name: /تسجيل عملية بالصوت/ })
    .click();
  await expect(
    page.getByRole("heading", { name: "سجّل عملية بالصوت", level: 1 }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "بدء الاستماع" }),
  ).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({
    path: `${SHOTS}/voice-idle-390.png`,
    fullPage: true,
  });

  const transcript = page.getByLabel("نص العملية");
  await transcript.fill("كم ربحت هذا الأسبوع؟");
  await page.getByRole("button", { name: "تنفيذ" }).click();
  await expect(page.getByText(/الربح الإجمالي \(/)).toBeVisible();
  await page.screenshot({
    path: `${SHOTS}/voice-answer-390.png`,
    fullPage: true,
  });

  const before = await invoiceCount();
  await page.getByRole("button", { name: "عملية جديدة" }).click();
  await transcript.fill("بعت عبوتين Arar ودفع كامل");
  await page.getByRole("button", { name: "تنفيذ" }).click();

  // A short spoken name is never auto-selected: the assistant asks which product.
  const question = page.getByRole("region", { name: /أي منتج تقصدين/ });
  await expect(question).toBeVisible();
  await page.screenshot({
    path: `${SHOTS}/voice-clarify-390.png`,
    fullPage: true,
  });
  await question
    .getByRole("button")
    .filter({ hasText: "Arar" })
    .first()
    .click();

  const review = page.getByRole("region", { name: "تأكيد عملية البيع" });
  await expect(review).toBeVisible();
  await expect(review).toContainText("Arar");
  expect(await invoiceCount()).toBe(before);
  await expectNoHorizontalOverflow(page);
  await page.screenshot({
    path: `${SHOTS}/voice-review-390.png`,
    fullPage: true,
  });

  await page.getByRole("button", { name: "تأكيد وحفظ البيع" }).click();
  await expect(
    page.getByRole("heading", { name: "تم حفظ البيع" }),
  ).toBeVisible();
  expect(await invoiceCount()).toBe(before + 1);

  await expect
    .poll(async () => {
      const rows = await withTestDb(
        (sql) => sql<{ status: string; source: string }[]>`
          select v.status, i.source
          from voice_commands v
          join customer_invoices i on i.id::text = v.result_entity_id
          order by v.created_at desc
          limit 1
        `,
      );
      return rows[0];
    })
    .toEqual({ status: "confirmed", source: "voice" });

  expect(issues.consoleErrors).toEqual([]);
  expect(issues.failedRequests).toEqual([]);
});
