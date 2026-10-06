import { expect, test, type Page } from "@playwright/test";
import sharp from "sharp";

import {
  expectNoHorizontalOverflow,
  login,
  trackPageIssues,
  withTestDb,
} from "./support";

const SHOTS = "artifacts/store-ops";
const ORIGINAL = "فرشاة سجاد";
const RENAMED = "فرشاة سجاد قوية";

test.describe.configure({ mode: "serial" });

async function productRow() {
  const rows = await withTestDb(
    (sql) => sql<{ name: string; src: string | null }[]>`
      select name_ar as name, image_src as src from products where domain_id = 'carpet-brush'
    `,
  );
  return rows[0]!;
}

async function openAssistant(page: Page) {
  await page.getByRole("button", { name: "فتح المساعد" }).click();
  const panel = page.getByRole("dialog", { name: "المساعد" });
  await expect(panel).toBeVisible();
  await expect(panel.getByLabel("رسالتك للمساعد")).toBeFocused();
  return panel;
}

async function ask(page: Page, text: string) {
  const panel = page.getByRole("dialog", { name: "المساعد" });
  await panel.getByLabel("رسالتك للمساعد").fill(text);
  await panel.getByRole("button", { name: "إرسال" }).click();
}

test.afterAll(async () => {
  await withTestDb(
    (sql) =>
      sql`update products set name_ar = ${ORIGINAL} where domain_id = 'carpet-brush'`,
  );
});

test("mobile: question, search, confirmed rename and image replacement", async ({
  page,
}) => {
  test.setTimeout(150_000);
  const issues = trackPageIssues(page);
  await login(page);

  const launcher = page.getByRole("button", { name: "فتح المساعد" });
  const nav = page.getByRole("navigation", { name: "التنقل السفلي" });
  const launcherBox = (await launcher.boundingBox())!;
  const navBox = (await nav.boundingBox())!;
  expect(launcherBox.width).toBeGreaterThanOrEqual(48);
  expect(launcherBox.height).toBeGreaterThanOrEqual(48);
  expect(launcherBox.y + launcherBox.height).toBeLessThanOrEqual(navBox.y);
  await page.screenshot({ path: `${SHOTS}/assistant-launcher-390.png` });

  const panel = await openAssistant(page);
  await expectNoHorizontalOverflow(page);

  await ask(page, "كم ربحت هذا الأسبوع؟");
  await expect(panel.getByText(/الربح الإجمالي \(هذا الأسبوع\)/)).toBeVisible();

  await ask(page, `ابحث عن ${ORIGINAL}`);
  await expect(panel.getByRole("list", { name: "نتائج البحث" })).toContainText(
    ORIGINAL,
  );

  await ask(page, `غير اسم ${ORIGINAL} إلى ${RENAMED}`);
  const card = panel.getByRole("region", { name: `تعديل منتج: ${ORIGINAL}` });
  await expect(card).toBeVisible();
  await expect(card).toContainText("بانتظار تأكيدك");
  await expect(card.locator("del")).toHaveText(ORIGINAL);
  await expect(card.locator("ins")).toHaveText(RENAMED);
  expect((await productRow()).name).toBe(ORIGINAL);
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: `${SHOTS}/assistant-confirm-390.png` });

  await card.getByRole("button", { name: "تأكيد التعديل" }).click();
  await expect(card.getByRole("status")).toContainText(`تم تعديل ${RENAMED}`);
  await expect(card.getByRole("link", { name: "فتح السجل" })).toHaveAttribute(
    "href",
    "/admin/products/carpet-brush",
  );
  expect((await productRow()).name).toBe(RENAMED);
  await page.screenshot({ path: `${SHOTS}/assistant-done-390.png` });

  const photo = await sharp({
    create: { width: 500, height: 500, channels: 3, background: "#2a7a5a" },
  })
    .png()
    .toBuffer();
  await panel.getByLabel("اختيار مرفقات").setInputFiles({
    name: "brush.png",
    mimeType: "image/png",
    buffer: photo,
  });
  const attachments = panel.getByRole("list", { name: "المرفقات" });
  await expect(
    attachments.getByRole("img", { name: "معاينة brush.png" }),
  ).toBeVisible();
  await expect(attachments.getByLabel("جارٍ الرفع")).toHaveCount(0);
  await ask(page, `صورة جديدة لـ ${RENAMED}`);
  const imageCard = panel.getByRole("region", {
    name: `استبدال صورة المنتج: ${RENAMED}`,
  });
  await expect(
    imageCard.getByRole("img", { name: "الصورة الجديدة" }),
  ).toBeVisible();
  await expect(imageCard).toContainText("بدون صورة");
  await page.screenshot({ path: `${SHOTS}/assistant-image-390.png` });
  await imageCard.getByRole("button", { name: "تأكيد استبدال الصورة" }).click();
  await expect(imageCard.getByRole("status")).toContainText(
    "تم استبدال صورة المنتج",
  );
  expect((await productRow()).src).toMatch(
    /^\/dev-product-images\/[0-9a-f-]{36}\.webp$/,
  );

  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await expect(launcher).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "المساعد" })).toContainText(
    RENAMED,
  );

  expect(issues.consoleErrors).toEqual([]);
  expect(issues.failedRequests).toEqual([]);
});

test("desktop: side panel keeps the page visible and nothing overflows", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page);
  const panel = await openAssistant(page);
  await expect(
    page.getByRole("heading", { name: "اليوم", level: 1 }),
  ).toBeVisible();
  const box = (await panel.boundingBox())!;
  expect(box.width).toBeLessThanOrEqual(440);
  expect(box.x + box.width).toBeGreaterThan(1300);
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: `${SHOTS}/assistant-1440.png` });
});

test("microphone: denied permission and unsupported browser are explained", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: () =>
          Promise.reject(new DOMException("denied", "NotAllowedError")),
      },
    });
  });
  await login(page);
  const panel = await openAssistant(page);
  await panel.getByRole("button", { name: "تسجيل صوتي" }).click();
  await expect(panel.locator(".assistant-status")).toContainText(
    "لم يُسمح باستخدام الميكروفون",
  );
  await expect(panel.getByLabel("رسالتك للمساعد")).toHaveValue("");

  await page.addInitScript(() => {
    Object.defineProperty(window, "MediaRecorder", {
      configurable: true,
      value: undefined,
    });
  });
  await page.reload();
  const again = await openAssistant(page);
  await again.getByRole("button", { name: "تسجيل صوتي" }).click();
  await expect(again.locator(".assistant-status")).toContainText(
    "لا يدعم التسجيل الصوتي",
  );
});

test("the chat and confirmation endpoints are closed without a session", async ({
  request,
}) => {
  const chat = await request.post("/admin/api/assistant/chat", {
    data: {
      message: { id: "x", role: "user", parts: [{ type: "text", text: "hi" }] },
    },
    maxRedirects: 0,
  });
  expect([307, 401, 403]).toContain(chat.status());
  const confirm = await request.post(
    "/admin/api/assistant/confirmations/00000000-0000-4000-8000-000000000000",
    {
      data: { action: "confirm", operation: "productUpdate", token: "x" },
      maxRedirects: 0,
    },
  );
  expect([307, 401, 403]).toContain(confirm.status());
});
