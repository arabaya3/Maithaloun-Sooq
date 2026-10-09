import { expect, test, type Page } from "@playwright/test";

import {
  expectNoHorizontalOverflow,
  login,
  trackPageIssues,
  withTestDb,
} from "./support";

// A cloth sold one piece at a time (4 ₪) or as a 3-pack (10 ₪); stock is always counted in pieces.
const STORE = { domainId: "e2e-cloth", name: "ممسحة باكيج تجريبية" };
const BLUE = `${STORE.domainId}--blue`;
const GREEN = `${STORE.domainId}--green`;
const RED = `${STORE.domainId}--red`;
const ASSISTANT = { domainId: "e2e-mops", name: "مماسح" };
const SHOTS = "artifacts/selling-units";

test.describe.configure({ mode: "serial" });

async function retireFixtures() {
  await withTestDb(async (sql) => {
    const names = [STORE.name, ASSISTANT.name];
    // Orders, stock movements and selling units keep history, so old fixtures are archived under new ids.
    const suffix = `-old-${Date.now()}`;
    await sql`
      update product_variants v set domain_id = v.domain_id || ${suffix}, archived_at = coalesce(v.archived_at, now()),
        is_default = false
      from products p where p.id = v.product_id and p.name_ar in ${sql(names)}`;
    await sql`
      update products set domain_id = domain_id || ${suffix}, slug = slug || ${suffix},
        name_ar = name_ar || ' (قديم)', publication = 'draft', archived_at = now()
      where name_ar in ${sql(names)}`;
  });
}

async function seedProduct(
  fixture: { domainId: string; name: string },
  variants: Array<{
    key: string;
    label: string;
    price: number;
    isDefault: boolean;
    packs: Array<{ label: string; units: number; price: number }>;
    pieces: number;
  }>,
) {
  await withTestDb(async (sql) => {
    const [owner] = await sql<{ id: string }[]>`
      select id from admin_users where role = 'owner' limit 1`;
    const [location] = await sql<{ id: string }[]>`
      select id from inventory_locations where is_default limit 1`;
    const [product] = await sql<{ id: string }[]>`
      insert into products (domain_id, slug, name_ar, price_agorot, sort_order, category_id, availability,
        publication, image_kind, placeholder_variant, details_status)
      values (${fixture.domainId}, ${fixture.domainId}, ${fixture.name}, ${variants[0]!.price}, 950, 'tools',
        'available', 'published', 'placeholder', 'brush', 'placeholder')
      returning id`;
    for (const [order, variant] of variants.entries()) {
      // The variant trigger adds the default one-piece unit at the variant price.
      const [row] = await sql<{ id: string }[]>`
        insert into product_variants (product_id, domain_id, label_ar, attributes, price_agorot, availability,
          image_kind, placeholder_variant, sort_order, is_default)
        values (${product!.id}, ${`${fixture.domainId}--${variant.key}`}, ${variant.label},
          ${sql.json({ اللون: variant.label })}, ${variant.price}, 'available', 'placeholder', 'brush',
          ${order}, ${variant.isDefault})
        returning id`;
      for (const [index, pack] of variant.packs.entries()) {
        await sql`
          insert into product_selling_units (product_id, variant_id, label_ar, units_per_sale, price_agorot, sort_order)
          values (${product!.id}, ${row!.id}, ${pack.label}, ${pack.units}, ${pack.price}, ${index + 1})`;
      }
      if (variant.pieces > 0) {
        const [item] = await sql<{ id: string }[]>`
          insert into inventory_items (variant_id, location_id, unit)
          values (${row!.id}, ${location!.id}, 'piece') returning id`;
        await sql`
          insert into stock_movements (inventory_item_id, reason, qty_delta_milli, value_delta_agorot,
            unit_cost_agorot, on_hand_after_milli, reserved_after_milli, value_after_agorot, idempotency_key, created_by)
          values (${item!.id}, 'opening_balance', ${variant.pieces * 1000}, ${variant.pieces * 200}, 200, 0, 0, 0,
            ${`e2e-selling-${crypto.randomUUID()}`}, ${owner!.id})`;
      }
    }
  });
}

async function stockOf(variantDomainId: string) {
  return withTestDb(async (sql) => {
    const [row] = await sql<{ on_hand: number; reserved: number }[]>`
      select i.on_hand_milli as on_hand, i.reserved_milli as reserved
      from inventory_items i join product_variants v on v.id = i.variant_id
      where v.domain_id = ${variantDomainId}`;
    return row!;
  });
}

async function unitIds(variantDomainId: string) {
  return withTestDb(
    (sql) => sql<{ id: string; units: number; label: string }[]>`
      select s.id, s.units_per_sale as units, s.label_ar as label
      from product_selling_units s join product_variants v on v.id = s.variant_id
      where v.domain_id = ${variantDomainId} order by s.units_per_sale`,
  );
}

function purchaseOptions(page: Page) {
  return page.getByRole("radiogroup", { name: "طريقة الشراء" });
}

async function expectTouchTargets(page: Page, selector: string) {
  const boxes = await page
    .locator(selector)
    .evaluateAll((elements) =>
      elements.map((element) => element.getBoundingClientRect()),
    );
  expect(boxes.length).toBeGreaterThan(0);
  for (const box of boxes) {
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
}

test.beforeAll(async () => {
  await retireFixtures();
  await seedProduct(STORE, [
    {
      key: "blue",
      label: "أزرق",
      price: 400,
      isDefault: true,
      packs: [{ label: "باكيج 3 حبات", units: 3, price: 1000 }],
      pieces: 10,
    },
    {
      key: "green",
      label: "أخضر",
      price: 450,
      isDefault: false,
      packs: [{ label: "كرتونة 6 حبات", units: 6, price: 2400 }],
      pieces: 20,
    },
    {
      key: "red",
      label: "أحمر",
      price: 400,
      isDefault: false,
      packs: [{ label: "باكيج 3 حبات", units: 3, price: 1000 }],
      pieces: 2,
    },
  ]);
  await seedProduct(ASSISTANT, [
    {
      key: "default",
      label: "عادي",
      price: 400,
      isDefault: true,
      packs: [],
      pieces: 10,
    },
  ]);
});

test.afterAll(retireFixtures);

test("a single and two 3-packs reach the cart, the order and the stock as pieces", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const issues = trackPageIssues(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/products/${STORE.domainId}`);

  const options = purchaseOptions(page);
  await expect(
    options.getByRole("radio", { name: /حبة واحدة/ }),
  ).toHaveAttribute("aria-checked", "true");
  await expect(
    options.getByRole("radio", { name: /باكيج 3 حبات/ }),
  ).toContainText("3.33 ₪ للحبة");
  await expect(
    page.locator("article.product-detail").getByLabel("السعر 4 ₪"),
  ).toBeVisible();
  const actions = page.locator(".product-detail-actions");
  await actions.getByRole("button", { name: "أضف إلى السلة" }).click();

  await options.getByRole("radio", { name: /باكيج 3 حبات/ }).click();
  await expect(
    page.locator("article.product-detail").getByLabel("السعر 10 ₪"),
  ).toBeVisible();
  await expect(actions.getByText("العدد من «باكيج 3 حبات»")).toBeVisible();
  await actions
    .getByRole("button", { name: `زيادة كمية ${STORE.name} — باكيج 3 حبات` })
    .click();
  await expect(
    actions.getByText("2 × باكيج 3 حبات = 6 حبات · 20 ₪"),
  ).toBeVisible();
  await page.screenshot({
    path: `${SHOTS}/product-pack-390.png`,
    fullPage: true,
  });
  await actions.getByRole("button", { name: "أضف إلى السلة" }).click();

  await page.goto("/cart");
  const lines = page.getByRole("article");
  await expect(lines).toHaveCount(2);
  const pack = lines.filter({ hasText: "باكيج 3 حبات × 2" });
  await expect(pack).toContainText("إجمالي القطع: 6");
  await expect(pack.getByLabel(`مجموع ${STORE.name} 20 ₪`)).toBeVisible();
  await expect(pack).not.toContainText("2 حبة");
  await expect(
    lines
      .filter({ hasText: "حبة واحدة × 1" })
      .getByLabel(`مجموع ${STORE.name} 4 ₪`),
  ).toBeVisible();
  await expect(page.getByLabel("مجموع المنتجات 24 ₪")).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/cart-390.png`, fullPage: true });

  const ordersBefore = await withTestDb(
    (sql) =>
      sql<{ count: number }[]>`select count(*)::int as count from orders`,
  );
  await page.getByRole("link", { name: "متابعة إلى بيانات الطلب" }).click();
  await page
    .getByRole("textbox", { name: "الاسم الكامل" })
    .fill("عميل الباكيج");
  await page.getByRole("textbox", { name: "الرقم المحلي" }).fill("0591234567");
  await page
    .getByRole("textbox", { name: "العنوان بالتفصيل أو أقرب نقطة دالة" })
    .fill("عنوان محلي مفصل للاختبار");
  // A double tap must still create a single order.
  await page.getByRole("button", { name: "تأكيد الطلب" }).dblclick();
  await expect(page).toHaveURL(/\/orders\/MS-[A-Za-z0-9_-]{24}\/confirmation/, {
    timeout: 20_000,
  });
  const reference = page.url().match(/MS-[A-Za-z0-9_-]{24}/)![0];
  const ordersAfter = await withTestDb(
    (sql) =>
      sql<{ count: number }[]>`select count(*)::int as count from orders`,
  );
  expect(ordersAfter[0]!.count).toBe(ordersBefore[0]!.count + 1);

  const items = await withTestDb(
    (sql) => sql<
      {
        label: string;
        quantity: number;
        units: number;
        base: number;
        price: number;
      }[]
    >`
      select i.selling_unit_label_snapshot as label, i.quantity, i.units_per_sale as units,
        i.base_units as base, i.unit_price_agorot as price
      from order_items i join orders o on o.id = i.order_id
      where o.public_reference = ${reference} order by i.units_per_sale`,
  );
  expect(items).toEqual([
    { label: "حبة واحدة", quantity: 1, units: 1, base: 1, price: 400 },
    { label: "باكيج 3 حبات", quantity: 2, units: 3, base: 6, price: 1000 },
  ]);

  await login(page);
  await page.goto(`/admin/orders/${reference}`);
  await expect(page.getByText("باكيج 3 حبات × 2")).toBeVisible();
  await page.getByRole("button", { name: "تأكيد الطلب" }).click();
  await expect(page.getByText("محجوز من المخزون").first()).toBeVisible({
    timeout: 15_000,
  });
  expect(await stockOf(BLUE)).toEqual({ on_hand: 10_000, reserved: 7_000 });
  expect(issues.consoleErrors).toEqual([]);
  expect(issues.failedRequests).toEqual([]);
});

test("with two pieces left the pack is unavailable and singles stop at two", async ({
  page,
}) => {
  const issues = trackPageIssues(page);
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto(`/products/${STORE.domainId}?variant=${RED}`);
  const options = purchaseOptions(page);
  const pack = options.getByRole("radio", { name: /باكيج 3 حبات/ });
  await expect(pack).toBeDisabled();
  await expect(pack).toContainText("غير متوفر حالياً");
  const actions = page.locator(".product-detail-actions");
  const increase = actions.getByRole("button", {
    name: `زيادة كمية ${STORE.name}`,
  });
  await increase.click();
  await expect(increase).toBeDisabled();
  await expect(actions.locator("output")).toHaveText("2");
  await expectNoHorizontalOverflow(page);
  expect(issues.consoleErrors).toEqual([]);
});

test("changing the colour re-resolves the ways of buying and their prices", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/products/${STORE.domainId}`);
  const options = purchaseOptions(page);
  await options.getByRole("radio", { name: /باكيج 3 حبات/ }).click();
  await page.getByRole("radio", { name: "أخضر" }).click();
  await expect(
    options.getByRole("radio", { name: /باكيج 3 حبات/ }),
  ).toHaveCount(0);
  await expect(
    options.getByRole("radio", { name: /حبة واحدة/ }),
  ).toHaveAttribute("aria-checked", "true");
  await expect(
    options.getByRole("radio", { name: /كرتونة 6 حبات/ }),
  ).toContainText("24 ₪");
  await expect(
    page.locator("article.product-detail").getByLabel("السعر 4.5 ₪"),
  ).toBeVisible();
  await page.getByRole("radio", { name: "أزرق" }).click();
  await expect(
    page.locator("article.product-detail").getByLabel("السعر 4 ₪"),
  ).toBeVisible();
  // Keyboard: arrows move the purchase choice in reading order.
  await options.getByRole("radio", { name: /حبة واحدة/ }).focus();
  await page.keyboard.press("ArrowLeft");
  await expect(
    options.getByRole("radio", { name: /باكيج 3 حبات/ }),
  ).toBeFocused();
  await expect(
    page.locator("article.product-detail").getByLabel("السعر 10 ₪"),
  ).toBeVisible();
});

test("an archived pack keeps its order history and asks the cart for a new choice", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 390, height: 844 });
  const [, pack] = await unitIds(BLUE);
  await withTestDb(
    (sql) =>
      sql`update product_selling_units set archived_at = now() where id = ${pack!.id}`,
  );
  // Seeded before any page script runs, so the cart restores exactly this line.
  await page.addInitScript(
    ({ packId, productId, variantId }) =>
      window.localStorage.setItem(
        "souq-maythalun:cart:v3",
        JSON.stringify({
          version: 3,
          lines: [
            {
              productId,
              variantId,
              sellingUnitId: packId,
              unitsPerSale: 3,
              quantity: 1,
            },
          ],
        }),
      ),
    { packId: pack!.id, productId: STORE.domainId, variantId: BLUE },
  );
  await page.goto("/cart");
  await expect(page.getByText(/تغيّرت طريقة الشراء لهذا المنتج/)).toBeVisible();
  await expect(page.getByLabel("مجموع المنتجات 0 ₪")).toBeVisible();
  await page.goto("/checkout");
  await expect(
    page.getByRole("button", { name: "تأكيد الطلب" }),
  ).toBeDisabled();

  await login(page);
  const [order] = await withTestDb(
    (sql) => sql<{ reference: string }[]>`
      select o.public_reference as reference from orders o
      join order_items i on i.order_id = o.id where i.selling_unit_id = ${pack!.id}
      order by o.created_at desc limit 1`,
  );
  await page.goto(`/admin/orders/${order!.reference}`);
  await expect(page.getByText("باكيج 3 حبات × 2")).toBeVisible();
  await expect(page.getByText("إجمالي القطع: 6")).toBeVisible();
  await withTestDb(
    (sql) =>
      sql`update product_selling_units set archived_at = null where id = ${pack!.id}`,
  );
});

test("the owner edits ways of buying with specific errors and cannot publish a variant without one", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const issues = trackPageIssues(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await page.goto(`/admin/products/${STORE.domainId}?advanced=1`);
  const section = page.getByRole("region", { name: "طرق البيع" });
  await expect(section).toBeVisible();
  await section.locator("summary", { hasText: "أخضر" }).click();
  const add = section.getByRole("form", { name: "إضافة طريقة بيع لـ أخضر" });
  await add.getByRole("button", { name: "باكيج", exact: true }).click();
  await add.getByLabel("عدد الحبات التي تُخصم من المخزون").fill("0");
  await expect(
    add.getByText(
      "عدد الحبات داخل الباكيج يجب أن يكون رقماً صحيحاً أكبر من صفر.",
    ),
  ).toBeVisible();
  await add.getByLabel("عدد الحبات التي تُخصم من المخزون").fill("2");
  await expect(
    add.getByText(/بيع «باكيج» مرة واحدة يخصم حبتان من المخزون/),
  ).toBeVisible();
  await add.getByLabel("اسم طريقة البيع").fill("باكيج حبتين");
  await add.getByLabel("سعر البيع ₪").fill("0");
  await add.getByRole("button", { name: "إضافة طريقة بيع" }).click();
  await expect(section.getByRole("alert")).toHaveText(
    "سعر البيع يجب أن يكون أكبر من صفر.",
  );
  // Entered data stays after a failed save.
  await expect(add.getByLabel("اسم طريقة البيع")).toHaveValue("باكيج حبتين");
  await add.getByLabel("سعر البيع ₪").fill("8.5");
  await add.getByRole("button", { name: "إضافة طريقة بيع" }).click();
  await expect(section.getByRole("status")).toHaveText(
    "تمت إضافة طريقة البيع.",
  );
  expect((await unitIds(GREEN)).map((unit) => unit.units)).toEqual([1, 2, 6]);
  await page.screenshot({
    path: `${SHOTS}/admin-selling-units-390.png`,
    fullPage: true,
  });
  await expectNoHorizontalOverflow(page);

  await withTestDb(async (sql) => {
    await sql`delete from product_selling_units where variant_id =
      (select id from product_variants where domain_id = ${RED})
      and id not in (select selling_unit_id from order_items where selling_unit_id is not null)`;
    await sql`update products set publication = 'hidden' where domain_id = ${STORE.domainId}`;
  });
  await page.reload();
  await expect(
    page.getByRole("note", { name: "ما ينقص قبل النشر" }),
  ).toContainText("«أحمر»: لا يمكن نشر الصنف دون طريقة بيع واحدة على الأقل.");
  expect(issues.consoleErrors).toEqual([]);
  await withTestDb(
    (sql) =>
      sql`update products set publication = 'published' where domain_id = ${STORE.domainId}`,
  );
});

test("the assistant prepares both ways of buying on one card and applies them once", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await page.getByRole("button", { name: "فتح المساعد" }).click();
  const panel = page.getByRole("dialog", { name: "المساعد" });
  await panel.getByRole("button", { name: "محادثة جديدة" }).click();
  await panel
    .getByLabel("رسالتك للمساعد")
    .fill("ضيف للمماسح خيار حبة بأربعة وباكيج ثلاث حبات بعشرة");
  await panel.getByRole("button", { name: "إرسال" }).click();
  const card = panel
    .getByRole("region", { name: /إضافة طرق بيع: مماسح/ })
    .last();
  await expect(card).toContainText("موجودة: حبة واحدة");
  await expect(card).toContainText("جديد: باكيج 3 حبات");
  await expect(card).toContainText("3.33 ₪ للحبة");
  await expect(card).toContainText(
    "المتاح حالياً: 10 حبات = 3 × «باكيج 3 حبات»",
  );
  // Preparing changed nothing; typing «نعم» does not confirm either.
  expect((await unitIds(`${ASSISTANT.domainId}--default`)).length).toBe(1);
  await panel.getByLabel("رسالتك للمساعد").fill("نعم");
  await panel.getByRole("button", { name: "إرسال" }).click();
  await expect(
    panel.getByText(/الكتابة في المحادثة لا تنفّذ العملية/).last(),
  ).toBeVisible();
  expect((await unitIds(`${ASSISTANT.domainId}--default`)).length).toBe(1);

  await card.getByRole("button", { name: "تأكيد إضافة طرق البيع" }).dblclick();
  await expect(card.getByRole("status")).toContainText(
    "تمت إضافة 1 من طرق البيع",
  );
  expect(
    (await unitIds(`${ASSISTANT.domainId}--default`)).map((unit) => [
      unit.units,
      unit.label,
    ]),
  ).toEqual([
    [1, "حبة واحدة"],
    [3, "باكيج 3 حبات"],
  ]);
  await page.screenshot({
    path: `${SHOTS}/assistant-card-390.png`,
    fullPage: true,
  });
});

test("the assistant records anonymous cash sales of a single and of packs from piece stock", async ({
  page,
}) => {
  test.setTimeout(150_000);
  const issues = trackPageIssues(page);
  await page.setViewportSize({ width: 390, height: 844 });
  const variant = `${ASSISTANT.domainId}--default`;
  const invoices = () =>
    withTestDb(
      (sql) => sql<
        {
          customer: string | null;
          total: number;
          paid: number;
          cogs: number;
          packs: number;
          pieces: number;
        }[]
      >`
        select i.customer_id as customer, i.total_agorot as total, i.paid_at_sale_agorot as paid,
          i.cogs_agorot as cogs, l.pack_quantity as packs, l.quantity_milli as pieces
        from customer_invoices i join customer_invoice_lines l on l.invoice_id = i.id
        join product_variants v on v.id = l.variant_id
        where v.domain_id = ${variant} order by i.created_at`,
    );
  await login(page);
  await page.getByRole("button", { name: "فتح المساعد" }).click();
  const panel = page.getByRole("dialog", { name: "المساعد" });
  await panel.getByRole("button", { name: "محادثة جديدة" }).click();
  const say = async (text: string) => {
    await panel.getByLabel("رسالتك للمساعد").fill(text);
    await panel.getByRole("button", { name: "إرسال" }).click();
  };

  await say(`بعت نقدي 1 حبة من ${ASSISTANT.name}`);
  const single = panel
    .getByRole("region", { name: "تسجيل بيع: بيع نقدي بدون اسم" })
    .last();
  await expect(single).toContainText("4 ₪");
  await single.getByRole("button", { name: "تأكيد وحفظ البيع" }).click();
  await expect(single.getByRole("status")).toContainText("تم حفظ البيع");

  await say(`بعت نقدي 2 باكيج من ${ASSISTANT.name}`);
  const packs = panel
    .getByRole("region", { name: "تسجيل بيع: بيع نقدي بدون اسم" })
    .last();
  await expect(packs).toContainText("باكيج 3 حبات × 2");
  await expect(packs).toContainText("يخصم 6 من المخزون");
  await expect(packs).toContainText("ربح تقديري: 8 ₪");
  // A double tap still records one sale.
  await packs.getByRole("button", { name: "تأكيد وحفظ البيع" }).dblclick();
  await expect(packs.getByRole("status")).toContainText("تم حفظ البيع");

  expect(await invoices()).toEqual([
    {
      customer: null,
      total: 400,
      paid: 400,
      cogs: 200,
      packs: 1,
      pieces: 1_000,
    },
    {
      customer: null,
      total: 2_000,
      paid: 2_000,
      cogs: 1_200,
      packs: 2,
      pieces: 6_000,
    },
  ]);
  expect(await stockOf(variant)).toEqual({ on_hand: 3_000, reserved: 0 });

  // Three pieces are left, so two more packs are refused and nothing changes.
  await say(`بعت نقدي 2 باكيج من ${ASSISTANT.name}`);
  await expect(panel.getByText(/الكمية المتوفرة من/).last()).toBeVisible();
  expect(await invoices()).toHaveLength(2);
  expect(await stockOf(variant)).toEqual({ on_hand: 3_000, reserved: 0 });
  await page.screenshot({ path: `${SHOTS}/assistant-cash-sale-390.png` });
  expect(issues.consoleErrors).toEqual([]);
});

for (const viewport of [
  { width: 360, height: 800 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1440, height: 900 },
]) {
  test(`product and cart layout at ${viewport.width}×${viewport.height}`, async ({
    page,
  }) => {
    const issues = trackPageIssues(page);
    await page.setViewportSize(viewport);
    await page.goto(`/products/${STORE.domainId}`);
    await expect(purchaseOptions(page)).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await expectTouchTargets(page, ".selling-unit-option");
    await expectTouchTargets(
      page,
      ".product-detail-actions .quantity-control button",
    );
    // Arabic labels are not clipped inside the options.
    const clipped = await page
      .locator(".selling-unit-option")
      .evaluateAll((elements) =>
        elements.some(
          (element) => element.scrollWidth > element.clientWidth + 1,
        ),
      );
    expect(clipped).toBe(false);
    await purchaseOptions(page)
      .getByRole("radio", { name: /باكيج 3 حبات/ })
      .click();
    await page
      .locator(".product-detail-actions")
      .getByRole("button", { name: "أضف إلى السلة" })
      .click();
    await page.goto("/cart");
    await expect(page.getByText("باكيج 3 حبات × 1")).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await expectTouchTargets(page, ".cart-line .quantity-control button");
    await page.screenshot({
      path: `${SHOTS}/cart-${viewport.width}.png`,
      fullPage: true,
    });
    expect(issues.consoleErrors).toEqual([]);
    expect(issues.failedRequests).toEqual([]);
  });
}
