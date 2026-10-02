import { expect, test, type Page } from "@playwright/test";

import { expectNoHorizontalOverflow, login, trackPageIssues } from "./support";

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

test.describe.configure({ mode: "serial" });

test("a dropped connection mid-reply leaves a retryable message and a working conversation", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  let panel = await openAssistant(page);
  await panel
    .getByRole("button", { name: "محادثة جديدة" })
    .click()
    .catch(() => undefined);

  await ask(page, "ابحث عن فرشاة سجاد رد بطيء");
  await expect(panel.getByText("البحث في المنتجات").first()).toBeVisible();
  // A real disconnect: the browser abandons the streaming request.
  await page.reload();

  panel = await openAssistant(page);
  const interrupted = panel.locator(".assistant-interrupted");
  await expect(interrupted.last()).toContainText("انقطع هذا الرد قبل اكتماله");

  const issues = trackPageIssues(page);
  await ask(page, "كم ربحت هذا الأسبوع؟");
  await expect(panel.getByText(/الربح الإجمالي \(هذا الأسبوع\)/)).toBeVisible();

  await interrupted
    .last()
    .getByRole("button", { name: "إعادة المحاولة" })
    .click();
  await expect(
    panel.getByRole("list", { name: "نتائج البحث" }).last(),
  ).toContainText("فرشاة سجاد");
  await expectNoHorizontalOverflow(page);
  expect(issues.consoleErrors).toEqual([]);
  expect(issues.failedRequests).toEqual([]);
});

test("money words, price errors and premature success claims are handled safely", async ({
  page,
}) => {
  const issues = trackPageIssues(page);
  await page.setViewportSize({ width: 360, height: 800 });
  await login(page);
  const panel = await openAssistant(page);
  await ask(
    page,
    "أضيفي منتج منظف تجربة الموثوقية بسعر خمستعش شيكل في مستلزمات منزلية مسودة",
  );
  const card = panel.getByRole("region", {
    name: "إضافة منتج جديد: منظف تجربة الموثوقية",
  });
  await expect(card).toContainText("15 ₪");
  await expect(card).toContainText("بانتظار تأكيدك");
  await card.getByRole("button", { name: "إلغاء" }).click();

  await ask(
    page,
    "أضيفي منتج منظف تجربة ثانية بسعر عشرة دولار في مستلزمات منزلية مسودة",
  );
  await expect(
    panel.getByText("ما قدرت أحدد السعر. اكتبه مثلاً: 15 شيكل.").last(),
  ).toBeVisible();
  await expect(
    panel.getByRole("region", { name: /منظف تجربة ثانية/ }),
  ).toHaveCount(0);

  await ask(page, "ادعي النجاح");
  await expect(
    panel
      .getByText(
        "لم يُنفَّذ أي تعديل. أقدر أجهّز بطاقة تراجعيها وتؤكديها بنفسك.",
      )
      .last(),
  ).toBeVisible();
  await ask(page, "اخترعي سعر");
  await expect(panel.getByText(/ما عندي رقم مؤكد لهذا/).last()).toBeVisible();
  await expectNoHorizontalOverflow(page);
  expect(issues.consoleErrors).toEqual([]);
  expect(issues.failedRequests).toEqual([]);
});
