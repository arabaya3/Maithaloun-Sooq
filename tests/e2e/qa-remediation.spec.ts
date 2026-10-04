import { expect, test, type Page } from "@playwright/test";
import sharp from "sharp";

import {
  admin,
  expectNoHorizontalOverflow,
  login,
  trackPageIssues,
  withTestDb,
} from "./support";

// Regressions for the Production QA findings; every fixture here is private to this file.
const PRODUCT = {
  domainId: "qa-fix-musk",
  slug: "qa-fix-musk",
  name: "مسك الاختبار",
};
const VARIANTS = [
  { suffix: "lavender", label: "لافندر", isDefault: true, archived: false },
  { suffix: "rose", label: "ورد", isDefault: false, archived: false },
  { suffix: "lemon", label: "ليمون", isDefault: false, archived: false },
  { suffix: "mint", label: "نعناع", isDefault: false, archived: true },
];

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

// Updated in place when present: QA orders may already reference these variants.
async function resetFixture() {
  await withTestDb(async (sql) => {
    const [existing] = await sql<{ id: string }[]>`
      select id from products where domain_id = ${PRODUCT.domainId}`;
    if (existing) {
      await sql`
        update products set name_ar = ${PRODUCT.name}, latin_name = null, publication = 'published',
          availability = 'available', archived_at = null
        where id = ${existing.id}`;
      for (const variant of VARIANTS) {
        await sql`
          update product_variants set sku = null, barcode = null,
            availability = ${variant.archived ? "unavailable" : "available"},
            archived_at = ${variant.archived ? new Date() : null}
          where domain_id = ${`${PRODUCT.domainId}--${variant.suffix}`}`;
      }
      return;
    }
    const [product] = await sql<{ id: string }[]>`
      insert into products (domain_id, slug, name_ar, price_agorot, sort_order, category_id, availability,
        publication, image_kind, placeholder_variant, details_status)
      values (${PRODUCT.domainId}, ${PRODUCT.slug}, ${PRODUCT.name}, 1200, 950, 'home', 'available',
        'published', 'placeholder', 'general-cleaner', 'placeholder')
      returning id`;
    for (const [index, variant] of VARIANTS.entries()) {
      await sql`
        insert into product_variants (product_id, domain_id, label_ar, attributes, price_agorot, availability,
          image_kind, placeholder_variant, sort_order, is_default, archived_at)
        values (${product!.id}, ${`${PRODUCT.domainId}--${variant.suffix}`}, ${variant.label},
          ${sql.json({ scent: variant.label })}, 1200, ${variant.archived ? "unavailable" : "available"},
          'placeholder', 'general-cleaner', ${index}, ${variant.isDefault},
          ${variant.archived ? new Date() : null})`;
    }
  });
}

test.beforeAll(resetFixture);

test("P2: a 9.5 MB image shows a size error instead of crashing the admin page", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await login(page);
  await page.goto(`/admin/products/${PRODUCT.domainId}`);
  const editor = page.getByRole("region", { name: "الصور والخيارات والأصناف" });
  const big = Buffer.alloc(Math.round(9.5 * 1024 * 1024), 0xff);
  await editor.locator('input[name="images"]').setInputFiles({
    name: "big.jpg",
    mimeType: "image/jpeg",
    buffer: big,
  });
  await editor.getByRole("button", { name: "رفع الصور" }).click();
  await expect(editor.getByRole("alert")).toHaveText(
    "big.jpg: الصورة أكبر من 8 ميغابايت.",
  );
  await expect(
    page.getByRole("heading", { name: "تعديل المنتج" }),
  ).toBeVisible();

  // The server refuses it on its own too, before reading the body.
  const origin = new URL(page.url()).origin;
  const refused = await page.request.post(
    `/admin/api/products/${PRODUCT.domainId}/images`,
    {
      data: big,
      headers: {
        "Content-Type": "image/jpeg",
        Origin: origin,
        "Sec-Fetch-Site": "same-origin",
      },
    },
  );
  expect(refused.status()).toBe(413);
  expect(await refused.json()).toMatchObject({
    ok: false,
    message: "الصورة أكبر من 8 ميغابايت.",
  });

  // An image over the old 1 MB action limit now uploads.
  const noisy = await sharp({
    create: {
      width: 900,
      height: 900,
      channels: 3,
      background: "#888",
      noise: { type: "gaussian", mean: 128, sigma: 60 },
    },
  })
    .png()
    .toBuffer();
  expect(noisy.byteLength).toBeGreaterThan(1024 * 1024);
  await editor.locator('input[name="images"]').setInputFiles({
    name: "noisy.png",
    mimeType: "image/png",
    buffer: noisy,
  });
  await editor.getByRole("button", { name: "رفع الصور" }).click();
  await expect(editor.getByRole("status")).toHaveText("تمت إضافة الصورة.", {
    timeout: 30_000,
  });
  await expect(editor.getByText("الصور (1 من 8)")).toBeVisible();

  // Without a session the request is turned away before the handler; nothing is stored.
  const unauthenticated = await page.context().browser()!.newContext();
  const anonymous = await unauthenticated.request.post(
    `${origin}/admin/api/products/${PRODUCT.domainId}/images`,
    {
      data: noisy,
      maxRedirects: 0,
      headers: { Origin: origin, "Sec-Fetch-Site": "same-origin" },
    },
  );
  expect([302, 303, 307, 401]).toContain(anonymous.status());
  const images = await withTestDb(
    (sql) => sql<{ total: number }[]>`
      select count(*)::int as total from product_images i
      join products p on p.id = i.product_id where p.domain_id = ${PRODUCT.domainId}`,
  );
  expect(images[0]!.total).toBe(1);
  await unauthenticated.close();
});

test("P3: saving a product confirms it, and owner controls cover publication, SKU, barcode and archived variants", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const issues = trackPageIssues(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await page.goto(`/admin/products/${PRODUCT.domainId}`);
  await page.getByLabel("الاسم اللاتيني اختياري").fill("Test Musk");
  await page.getByRole("button", { name: "حفظ المنتج" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "تم حفظ تغييرات المنتج." }),
  ).toBeVisible();

  const controls = page.getByRole("region", {
    name: "النشر والرموز والأصناف المؤرشفة",
  });
  await expect(controls.getByTestId("publication-state")).toHaveText(
    "منشور في المتجر",
  );
  await controls.getByLabel("الحالة الجديدة").selectOption("draft");
  await controls.getByRole("button", { name: "حفظ حالة النشر" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "تم تحديث حالة النشر." }),
  ).toBeVisible();
  await expect(controls.getByTestId("publication-state")).toHaveText(
    "مسودة — لا يظهر في المتجر",
  );
  await controls.getByLabel("الحالة الجديدة").selectOption("published");
  await controls.getByRole("button", { name: "حفظ حالة النشر" }).click();
  await expect(controls.getByTestId("publication-state")).toHaveText(
    "منشور في المتجر",
  );

  await controls.getByText(/^SKU والباركود/).click();
  const rose = controls.getByRole("form", { name: "رموز الصنف ورد" });
  await rose.getByLabel("SKU").fill("QA-ROSE-1");
  await rose.getByLabel("الباركود").fill("7290001112223");
  await rose.getByRole("button", { name: "حفظ الرموز" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "تم حفظ الصنف." }),
  ).toBeVisible();
  const stored = await withTestDb(
    (sql) => sql<{ sku: string; barcode: string }[]>`
      select sku, barcode from product_variants where domain_id = ${`${PRODUCT.domainId}--rose`}`,
  );
  expect(stored[0]).toEqual({ sku: "QA-ROSE-1", barcode: "7290001112223" });

  const archived = controls.getByRole("listitem").filter({ hasText: "نعناع" });
  await archived.getByRole("button", { name: "استعادة الصنف" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "تمت استعادة الصنف المؤرشف." }),
  ).toBeVisible();
  await expect(controls.getByText("أصناف مؤرشفة (0)")).toBeVisible();
  await expectNoHorizontalOverflow(page);
  expect(issues.consoleErrors).toEqual([]);
});

test("owner manages categories by hand", async ({ page }) => {
  await login(page);
  await page.goto("/admin/categories");
  const create = page.getByRole("form", { name: "إضافة قسم" });
  await create.getByLabel("اسم القسم").fill("قسم اختبار الجودة");
  await create
    .getByLabel("الرمز (اختياري، أحرف لاتينية صغيرة)")
    .fill("qa-fix-category");
  await create.getByRole("button", { name: "إضافة القسم" }).click();
  await expect(page.getByRole("status")).toHaveText("تمت إضافة القسم.");
  const row = page.getByRole("listitem", { name: "القسم قسم اختبار الجودة" });
  await row.getByLabel("الاسم").fill("قسم اختبار الجودة المعدل");
  await row.getByRole("button", { name: "حفظ القسم" }).click();
  await expect(page.getByRole("status")).toHaveText("تم حفظ القسم.");
  const renamed = page.getByRole("listitem", {
    name: "القسم قسم اختبار الجودة المعدل",
  });
  await renamed.getByRole("button", { name: "أرشفة القسم" }).click();
  await expect(page.getByRole("status")).toHaveText("تمت أرشفة القسم.");
  await page.getByText(/^أقسام مؤرشفة/).click();
  await page
    .getByRole("listitem", { name: "القسم قسم اختبار الجودة المعدل" })
    .getByRole("button", { name: "استعادة القسم" })
    .click();
  await expect(page.getByRole("status")).toHaveText("تمت استعادة القسم.");
});

test("owner edits, archives and records a credit note for a supplier", async ({
  page,
}) => {
  await withTestDb(async (sql) => {
    await sql`delete from supplier_ledger_entries where supplier_id in (select id from suppliers where normalized_name in ('مورد اختبار الجوده', 'مورد اختبار الجوده المعدل'))`;
    await sql`delete from suppliers where normalized_name in ('مورد اختبار الجوده', 'مورد اختبار الجوده المعدل')`;
    const [supplier] = await sql<{ id: string }[]>`
      insert into suppliers (name_ar, normalized_name) values ('مورد اختبار الجودة', 'مورد اختبار الجوده') returning id`;
    await sql`
      insert into supplier_ledger_entries (supplier_id, type, amount_agorot, idempotency_key, created_by)
      values (${supplier!.id}, 'purchase', 5000, ${`qa-fix:${crypto.randomUUID()}`},
        (select id from admin_users where username = ${admin.TEST_ADMIN_USERNAME}))`;
  });
  await login(page);
  await page.goto("/admin/inventory/suppliers");
  await page.getByRole("link", { name: "مورد اختبار الجودة" }).click();
  await expect(page.getByRole("heading", { name: "كشف الحساب" })).toBeVisible();

  const note = page.getByRole("form", { name: "إشعار دائن من المورد" });
  await note.getByLabel("المبلغ ₪").fill("12");
  await note.getByLabel("رقم الإشعار").fill("CN-QA-1");
  await note.getByLabel("السبب").fill("بضاعة مرتجعة");
  await note.getByRole("button", { name: "تسجيل الإشعار الدائن" }).click();
  await expect(note.getByRole("status")).toHaveText(
    "تم تسجيل الإشعار الدائن وخُصم من المستحق للمورد.",
  );
  await page.reload();
  await expect(
    page.getByRole("table", { name: "حركات حساب المورد" }),
  ).toContainText("إشعار دائن CN-QA-1");
  await expect(
    page.getByRole("heading", { name: /المستحق للمورد/ }),
  ).toContainText("38");

  const edit = page.getByRole("form", { name: "تعديل المورد" });
  await edit.getByLabel("اسم المورد").fill("مورد اختبار الجودة المعدل");
  await edit.getByRole("button", { name: "حفظ بيانات المورد" }).click();
  await expect(edit.getByRole("status")).toHaveText("تم حفظ بيانات المورد.");
  await page.getByRole("button", { name: "أرشفة المورد" }).click();
  await expect(page.getByText("تمت أرشفة المورد.")).toBeVisible();
});

test("owner QA order needs no phone and never reaches notifications, queues or reports", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const before = await withTestDb(
    (sql) =>
      sql<
        { total: number }[]
      >`select count(*)::int as total from admin_notifications`,
  );
  await login(page);
  await page.goto("/admin/orders");
  await page.getByRole("link", { name: "طلبات الاختبار" }).click();
  const form = page.getByRole("form", { name: "إنشاء طلب اختبار" });
  await form
    .getByLabel("الصنف 1")
    .selectOption(`${PRODUCT.domainId}|${PRODUCT.domainId}--rose`);
  await form.getByRole("button", { name: "إنشاء طلب اختبار" }).click();
  await expect(page.getByTestId("qa-order-banner")).toContainText(
    "تم إنشاء طلب الاختبار.",
  );
  const reference = new URL(page.url()).pathname.split("/").at(-1)!;
  await expect(
    page.getByRole("button", { name: /تأكيد|تجهيز|توصيل/ }),
  ).toHaveCount(0);

  const rows = await withTestDb(
    (sql) => sql<{ is_test: boolean; whatsapp_phone_e164: string | null }[]>`
      select is_test, whatsapp_phone_e164 from orders where public_reference = ${reference}`,
  );
  expect(rows[0]).toEqual({ is_test: true, whatsapp_phone_e164: null });
  const after = await withTestDb(
    (sql) =>
      sql<
        { total: number }[]
      >`select count(*)::int as total from admin_notifications`,
  );
  expect(after[0]!.total).toBe(before[0]!.total);

  await page.goto("/admin/orders");
  await expect(page.getByText(reference)).toHaveCount(0);
  await page.goto("/admin/orders/qa");
  await expect(
    page.getByRole("list", { name: "طلبات الاختبار" }),
  ).toContainText(reference);
});

test("assistant: «نعم» points at the button, cards refresh, offers state their scope and a lone match is a confirmation", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await resetFixture();
  await login(page);
  const panel = await openAssistant(page);

  // A unique partial match asks to confirm the one result, not to pick among several.
  await ask(page, "غير اسم الاختبار مسك إلى مسك الاختبار الجديد");
  const lone = panel.getByRole("group", { name: /لقيت نتيجة واحدة قريبة/ });
  await expect(lone).toBeVisible();
  await expect(lone.getByRole("button")).toHaveCount(1);
  await expect(lone).not.toContainText("لافندر");
  await expect(panel.getByText(/أكثر من منتج/)).toHaveCount(0);

  // Restoring an archived variant by name from chat.
  await ask(page, `رجعي الصنف ${PRODUCT.name} نعناع`);
  const restore = panel.getByRole("region", { name: /استرجاع صنف مؤرشف/ });
  await expect(restore).toContainText("بانتظار تأكيدك");

  // Typing «نعم» does not run it; the reply names the card button.
  await ask(page, "نعم");
  await expect(
    panel.getByText("اضغطي زر «تأكيد الاسترجاع» في البطاقة أعلاه"),
  ).toBeVisible();
  const stillArchived = await withTestDb(
    (sql) => sql<{ archived: boolean }[]>`
      select archived_at is not null as archived from product_variants where domain_id = ${`${PRODUCT.domainId}--mint`}`,
  );
  expect(stillArchived[0]!.archived).toBe(true);
  await restore.getByRole("button", { name: "تأكيد الاسترجاع" }).click();
  await expect(restore).toContainText("تمت");
  await expect(restore).not.toContainText("بانتظار تأكيدك");

  // An offer named after one scent targets that scent only, and the card says so.
  await ask(page, `اعملي عرض خصم 10 بالمية على ${PRODUCT.name} لافندر`);
  const offer = panel.getByRole("region", { name: /إضافة عرض/ });
  await expect(offer).toContainText("صنف محدد فقط");
  await expect(offer).toContainText("المجموع 1 صنف");

  // Two cards on the same product: running one turns the other stale on screen.
  await ask(page, `غير اسم ${PRODUCT.name} إلى مسك أول`);
  const first = panel
    .getByRole("region", { name: `تعديل منتج: ${PRODUCT.name}` })
    .first();
  await expect(first).toContainText("بانتظار تأكيدك");
  await ask(page, `غير اسم ${PRODUCT.name} إلى مسك ثاني`);
  const cards = panel.getByRole("region", {
    name: `تعديل منتج: ${PRODUCT.name}`,
  });
  await expect(cards).toHaveCount(2);
  await cards.nth(0).getByRole("button", { name: /تأكيد/ }).click();
  await expect(cards.nth(0)).toContainText("تمت");
  await expect(cards.nth(1)).toContainText(
    "تغيّرت البيانات بعد تجهيز هذه البطاقة",
  );
  await expect(cards.nth(1)).not.toContainText("بانتظار تأكيدك");
  await withTestDb(
    (sql) =>
      sql`update products set name_ar = ${PRODUCT.name} where domain_id = ${PRODUCT.domainId}`,
  );
});

test("P3: a customer with no payments shows 0 ₪ paid, never -0 ₪", async ({
  page,
}) => {
  const [customer] = await withTestDb(
    (sql) => sql<{ id: string }[]>`
      insert into customers (name, normalized_name) values ('زبون بلا دفعات', 'زبون بلا دفعات')
      returning id`,
  );
  await login(page);
  await page.goto(`/admin/customers/${customer!.id}`);
  const paid = page.locator("dt", { hasText: "مجموع المدفوع" }).locator("+ dd");
  await expect(paid).toHaveText("0 ₪");
  await expect(page.getByText("-0 ₪")).toHaveCount(0);
});
