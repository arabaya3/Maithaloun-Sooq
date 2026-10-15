import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import {
  expectNoHorizontalOverflow,
  login,
  trackPageIssues,
  withTestDb,
} from "./support";

const HANDOFF = "تمام، حوّلت محادثتك لفريق المتجر";

test("owner tries the WhatsApp assistant in the simulator, takes over and hands back", async ({
  page,
}) => {
  const issues = trackPageIssues(page);
  await withTestDb(
    (sql) =>
      sql`delete from shop_conversations where customer_e164 = 'sim-owner'`,
  );
  await page.setViewportSize({ width: 360, height: 800 });
  await login(page);
  await page.goto("/admin/whatsapp");
  await expect(
    page.getByRole("heading", { name: "مساعد واتساب", level: 1 }),
  ).toBeVisible();
  // Without provider settings the page says the official channel is not connected.
  await expect(page.getByText("واتساب الرسمي غير موصول بعد")).toBeVisible();

  // Asking for a person is handled without the AI model: the chat is handed to the owner.
  await page.getByLabel("اكتبي كأنك زبونة").fill("بدي احكي مع حدا من المحل");
  await page.getByRole("button", { name: "إرسال للمساعد" }).click();
  const thread = page.locator(".admin-wa-thread");
  await expect(thread).toContainText("بدي احكي مع حدا من المحل");
  await expect(thread).toContainText(HANDOFF);
  await expect(page.getByText("طلب موظفاً")).toBeVisible();

  // While paused, a new customer message gets no automatic reply.
  await page.getByLabel("اكتبي كأنك زبونة").fill("مرحبا؟");
  await page.getByRole("button", { name: "إرسال للمساعد" }).click();
  await expect(thread).toContainText("مرحبا؟");
  await expect(thread.locator("li")).toHaveCount(3);

  // The owner answers personally.
  await page.getByLabel("ردّك").fill("أهلاً، معك المحل");
  await page.getByRole("button", { name: "إرسال الرد" }).click();
  await expect(thread.locator('li[data-author="owner"]')).toContainText(
    "أهلاً، معك المحل",
  );

  await expectNoHorizontalOverflow(page);
  const axe = await new AxeBuilder({ page })
    .include("main")
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(axe.violations.map((violation) => violation.id)).toEqual([]);

  // Handing back to the assistant clears the request for a person.
  await page
    .getByRole("button", { name: "إعادة تشغيل المساعد لهذه المحادثة" })
    .click();
  await expect(
    page.getByRole("button", { name: "إيقاف المساعد والرد بنفسي" }),
  ).toBeVisible();
  await expect(page.getByText("طلب موظفاً")).toHaveCount(0);

  // Simulator conversations and anything they create stay marked as tests.
  const rows = await withTestDb(
    (sql) =>
      sql<
        { is_test: boolean }[]
      >`select is_test from shop_conversations where customer_e164 = 'sim-owner'`,
  );
  expect(rows).toEqual([{ is_test: true }]);
  expect(issues).toEqual({ consoleErrors: [], failedRequests: [] });
});
