import { expect, test } from "@playwright/test";

import { expectNoHorizontalOverflow, login, withTestDb } from "./support";

const SHOTS = "artifacts/store-ops";
const CRON_SECRET = "e2e-cron-secret-0123456789abcdef0123456789";
const DEBTOR = "زبون التذكير";

test.describe.configure({ mode: "serial" });

test("the cron endpoint is closed without its secret and idempotent with it", async ({
  request,
}) => {
  expect((await request.get("/api/cron/daily")).status()).toBe(401);
  expect(
    (
      await request.get("/api/cron/daily", {
        headers: { Authorization: "Bearer wrong" },
      })
    ).status(),
  ).toBe(401);

  const first = await request.get("/api/cron/daily", {
    headers: { Authorization: `Bearer ${CRON_SECRET}` },
  });
  expect(first.status()).toBe(200);
  expect(first.headers()["cache-control"]).toContain("no-store");
  expect((await first.json()).status).toBe("completed");

  const second = await request.get("/api/cron/daily", {
    headers: { Authorization: `Bearer ${CRON_SECRET}` },
  });
  expect((await second.json()).status).toBe("skipped");
});

test("owner opens the archived summary and asks for an AI explanation", async ({
  page,
}) => {
  await login(page);
  await page.goto("/admin/reports");
  await page.getByRole("link", { name: "أرشيف الملخصات" }).click();
  await expect(
    page.getByRole("heading", { name: "أرشيف الملخصات", level: 1 }),
  ).toBeVisible();
  await page
    .getByRole("list")
    .getByRole("link", { name: /ملخص 14 يوماً/ })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { name: "الأرقام المحفوظة" }),
  ).toBeVisible();
  await expect(page.getByText(/تقرير آخر 14 يومًا جاهز/)).toBeVisible();
  await expect(page.getByText(/ملخص آلي — اقتراحات فقط/)).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({
    path: `${SHOTS}/summary-archive-390.png`,
    fullPage: true,
  });

  await page.goto("/admin/reports");
  await page.getByRole("button", { name: "اشرحي لي هذه الفترة" }).click();
  const insight = page.getByRole("region", { name: "ملخص ذكي" });
  await expect(insight.getByText(/ملخص آلي — اقتراحات فقط/)).toBeVisible();
  await expect(
    insight.getByRole("heading", { name: "اقتراحات" }),
  ).toBeVisible();

  await page.goto("/admin/settings");
  const frequency = page.getByRole("region", { name: "ملخص الأعمال الدوري" });
  await expect(
    frequency.getByRole("radio", { name: "كل 14 يوماً" }),
  ).toBeChecked();
  await frequency.getByRole("radio", { name: "شهرياً" }).check();
  await frequency.getByRole("button", { name: "حفظ الموعد" }).click();
  await expect(frequency.getByText("تم حفظ موعد الملخصات.")).toBeVisible();
  await frequency.getByRole("radio", { name: "كل 14 يوماً" }).check();
  await frequency.getByRole("button", { name: "حفظ الموعد" }).click();
});

test("a debt reminder leads to the customer ledger where it can be snoozed or disputed", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await login(page);
  await page.goto("/admin/sales/new");
  await page.getByRole("button", { name: /منتج السطر 1/ }).click();
  await page
    .getByRole("dialog", { name: "منتج السطر 1" })
    .getByRole("button")
    .filter({ hasText: "Musk" })
    .click();
  await page.getByRole("radio", { name: "زبون جديد" }).check();
  await page.getByLabel("اسم الزبون").fill(DEBTOR);
  await page.getByRole("radio", { name: "على الحساب" }).check();
  await page.getByRole("button", { name: "مراجعة البيع" }).click();
  await page.getByRole("button", { name: "تأكيد وحفظ البيع" }).click();
  await expect(
    page.getByRole("heading", { name: "تم حفظ البيع" }),
  ).toBeVisible();

  // Stand-in for the daily job five days later: the same rows it would write.
  await withTestDb(async (sql) => {
    const [customer] = await sql<{ id: string }[]>`
      select id from customers where name = ${DEBTOR}
    `;
    const [notification] = await sql<{ id: string }[]>`
      insert into admin_notifications (type, title, body, href, dedupe_key)
      values ('debt_reminder', 'تذكير بدين',
        ${`${DEBTOR} ما زال عليه 10 ₪ منذ 5 أيام`},
        ${`/admin/customers/${customer!.id}`},
        ${`debt-reminder:${customer!.id}:e2e`})
      returning id
    `;
    await sql`
      insert into customer_reminders
        (customer_id, reminder_date, balance_agorot, days_outstanding, notification_id, push_status)
      values (${customer!.id}, current_date, 1000, 5, ${notification!.id}, 'no_subscribers')
    `;
  });

  await page.goto("/admin/notifications");
  const reminder = page.getByRole("button", {
    name: new RegExp(`${DEBTOR} ما زال عليه`),
  });
  await expect(reminder).toBeVisible();
  await page.screenshot({
    path: `${SHOTS}/unpaid-reminder-390.png`,
    fullPage: true,
  });
  await reminder.click();
  await expect(
    page.getByRole("heading", { name: DEBTOR, level: 1 }),
  ).toBeVisible();

  const section = page.getByRole("region", { name: "التذكير بالدين" });
  await expect(section).toContainText("لا تُرسل أي رسالة للزبون");
  await expect(section.getByText(/بعد 5 يوم/)).toBeVisible();
  await section.getByRole("button", { name: "تأجيل أسبوع" }).click();
  await expect(section.getByText("أُجّل التذكير 7 أيام.")).toBeVisible();
  await expect(section.getByText(/التذكير مؤجَّل حتى/)).toBeVisible();

  await section.getByLabel("سبب النزاع (اختياري)").fill("يقول إنه دفع");
  await section
    .getByRole("button", { name: "الرصيد متنازع عليه — أوقفي التذكير" })
    .click();
  await expect(
    section.getByText(/الرصيد متنازع عليه: يقول إنه دفع/),
  ).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({
    path: `${SHOTS}/unpaid-balance-controls-390.png`,
    fullPage: true,
  });
});
