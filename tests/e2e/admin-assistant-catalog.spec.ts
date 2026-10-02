import { expect, test, type Page } from "@playwright/test";
import sharp from "sharp";

import {
  expectNoHorizontalOverflow,
  login,
  trackPageIssues,
  withTestDb,
} from "./support";

const SHOTS = "artifacts/store-ops";
const NAME = "منظف أرضيات بالخزامى";
const CATEGORY = "معطرات جو";

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

async function createdProducts() {
  return withTestDb(
    (sql) => sql<
      { domain_id: string; publication: string; variants: number }[]
    >`
      select p.domain_id, p.publication::text as publication,
        (select count(*)::int from product_variants v where v.product_id = p.id) as variants
      from products p where p.name_ar = ${NAME} order by p.created_at
    `,
  );
}

async function cleanUp() {
  await withTestDb(async (sql) => {
    await sql`delete from products where name_ar = ${NAME}`;
    await sql`delete from product_categories where name_ar = ${CATEGORY}`;
  });
}

test.beforeAll(cleanUp);
test.afterAll(cleanUp);

test("mobile: product from a photo, duplicate choice, variant, publication and destructive card", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const issues = trackPageIssues(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  const panel = await openAssistant(page);

  const photo = await sharp({
    create: { width: 500, height: 500, channels: 3, background: "#7a5ab0" },
  })
    .png()
    .toBuffer();
  await panel.getByLabel("اختيار مرفقات").setInputFiles({
    name: "bottle.png",
    mimeType: "image/png",
    buffer: photo,
  });
  const attachments = panel.getByRole("list", { name: "المرفقات" });
  await expect(attachments.getByLabel("جارٍ الرفع")).toHaveCount(0);
  await ask(page, "اقرئي صورة المنتج");
  const analysis = panel.getByRole("region", { name: "مسودة المنتج" });
  await expect(analysis.first()).toContainText(NAME);
  await expect(analysis.first()).toContainText("تحقّقي");
  await expect(analysis.first()).toContainText(/ناقص: .*سعر البيع/);
  await expect(analysis.first()).toContainText("القسم: مستلزمات منزلية");
  await expect(analysis.first()).toContainText("القسم: مستلزمات منزلية");
  await page.screenshot({ path: `${SHOTS}/assistant-analysis-390.png` });

  await ask(page, "السعر خمستعش شيكل");
  await expect(analysis.last()).toContainText("15 ₪");
  await ask(page, "السعر عشرة دولار");
  await expect(
    panel.getByText("ما قدرت أحدد السعر. اكتبه مثلاً: 15 شيكل.").last(),
  ).toBeVisible();
  await expect(analysis.last()).toContainText(/ناقص: .*سعر البيع/);

  await ask(
    page,
    `أضيفي منتج ${NAME} ماركة Fresh بسعر 12 قسم مستلزمات منزلية مسودة`,
  );
  const create = panel.getByRole("region", {
    name: `إضافة منتج جديد: ${NAME}`,
  });
  await expect(create).toContainText("بانتظار تأكيدك");
  await expect(create).toContainText("مسودة");
  await expect(create).toContainText("يمكن التراجع");
  expect(await createdProducts()).toHaveLength(0);
  await create.getByRole("button", { name: "تأكيد الإضافة" }).dblclick();
  await expect(create.getByRole("status")).toContainText(`تمت إضافة ${NAME}`);
  const created = await createdProducts();
  expect(created).toHaveLength(1);
  expect(created[0]).toMatchObject({ publication: "draft", variants: 1 });
  await expect(create.getByRole("link", { name: "فتح السجل" })).toHaveAttribute(
    "href",
    `/admin/products/${created[0]!.domain_id}`,
  );

  await ask(
    page,
    `أضيفي منتج ${NAME} ماركة Fresh بسعر 12 قسم مستلزمات منزلية مسودة`,
  );
  const choices = panel.getByRole("group", {
    name: "لقيت منتجات مشابهة. هل هو واحد منها (عدّلي الموجود) أم منتج جديد؟",
  });
  await expect(
    choices.getByRole("button", { name: /الموجود: منظف أرضيات بالخزامى/ }),
  ).toBeVisible();
  await choices.getByRole("button", { name: "منتج جديد مختلف" }).click();
  const duplicate = panel
    .getByRole("region", { name: `إضافة منتج جديد: ${NAME}` })
    .last();
  await expect(duplicate).toContainText("منتجات مشابهة");
  await duplicate.getByRole("button", { name: "إلغاء" }).click();
  await expect(duplicate).toContainText("أُلغيت العملية");
  expect(await createdProducts()).toHaveLength(1);

  await ask(page, `أضيفي صنف 2 لتر لـ ${NAME} بسعر 20`);
  const variant = panel.getByRole("region", { name: `إضافة صنف: ${NAME}` });
  await variant.getByRole("button", { name: "تأكيد الإضافة" }).click();
  await expect(variant.getByRole("status")).toContainText("تمت إضافة الصنف");
  expect((await createdProducts())[0]!.variants).toBe(2);

  await ask(page, `انشري ${NAME}`);
  const publish = panel.getByRole("region", {
    name: `تغيير ظهور المنتج: ${NAME}`,
  });
  await expect(publish).toContainText("سيظهر المنتج في المتجر");
  await publish.getByRole("button", { name: "تأكيد" }).click();
  await expect(publish.getByRole("status")).toBeVisible();
  expect((await createdProducts())[0]!.publication).toBe("published");

  await ask(page, `اخفي ${NAME}`);
  const hide = panel
    .getByRole("region", { name: `تغيير ظهور المنتج: ${NAME}` })
    .last();
  await expect(hide).toContainText("بانتظار تأكيدك");
  await withTestDb(
    (sql) =>
      sql`update admin_assistant_confirmations set expires_at = now() - interval '1 minute' where status = 'pending'`,
  );
  await hide.getByRole("button", { name: "تأكيد" }).click();
  await expect(hide.getByRole("alert")).toContainText("انتهت");
  expect((await createdProducts())[0]!.publication).toBe("published");

  await ask(page, `أضيفي قسم ${CATEGORY} بأيقونة spray-can`);
  const category = panel.getByRole("region", {
    name: `إضافة قسم: ${CATEGORY}`,
  });
  await category.getByRole("button", { name: "تأكيد الإضافة" }).click();
  await expect(category.getByRole("status")).toContainText(
    `تمت إضافة قسم ${CATEGORY}`,
  );

  await ask(page, `احذفي القسم ${CATEGORY} نهائياً`);
  const remove = panel.getByRole("region", {
    name: `حذف قسم نهائياً: ${CATEGORY}`,
  });
  await expect(remove).toContainText("حذف نهائي — لا يمكن التراجع");
  await expect(remove).toContainText("منتجات 0");
  const confirmDelete = remove.getByRole("button", { name: "حذف نهائي" });
  await expect(confirmDelete).toBeDisabled();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: `${SHOTS}/assistant-destructive-390.png` });
  await remove.getByRole("checkbox").check();
  await confirmDelete.click();
  await expect(remove.getByRole("status")).toContainText(
    "تم حذف القسم نهائياً",
  );
  const remaining = await withTestDb(
    (sql) =>
      sql`select code from product_categories where name_ar = ${CATEGORY}`,
  );
  expect(remaining).toHaveLength(0);

  await create.getByRole("link", { name: "فتح السجل" }).click();
  await expect(page).toHaveURL(
    new RegExp(`/admin/products/${created[0]!.domain_id}$`),
  );

  // The expired card is refused with 409 on purpose; Chromium logs every non-2xx fetch.
  expect(
    issues.consoleErrors.filter(
      (message) => !message.includes("status of 409 (Conflict)"),
    ),
  ).toEqual([]);
  expect(issues.consoleErrors.length).toBeLessThanOrEqual(1);
  expect(issues.failedRequests).toEqual([]);
});

for (const viewport of [
  { width: 360, height: 800 },
  { width: 768, height: 1024 },
  { width: 1440, height: 900 },
]) {
  test(`catalog answers fit at ${viewport.width}x${viewport.height}`, async ({
    page,
  }) => {
    const issues = trackPageIssues(page);
    await page.setViewportSize(viewport);
    await login(page);
    const panel = await openAssistant(page);
    await ask(page, "اعرضي الأقسام");
    await expect(
      panel.getByRole("list", { name: "الأقسام" }).last(),
    ).toContainText("منظفات الغسيل");
    await expectNoHorizontalOverflow(page);
    expect(issues.consoleErrors).toEqual([]);
    expect(issues.failedRequests).toEqual([]);
  });
}
