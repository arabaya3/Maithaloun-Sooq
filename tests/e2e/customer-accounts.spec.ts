import { expect, test, type Page } from "@playwright/test";

import {
  expectNoHorizontalOverflow,
  trackPageIssues,
  withTestDb,
} from "./support";

const CODE = "246810";
const PHONES = ["0597001001", "0597001002", "0597001003", "0597001004"];

test.describe.configure({ mode: "serial" });

async function cleanUp() {
  await withTestDb(async (sql) => {
    const e164 = PHONES.map((phone) => `+970${phone.slice(1)}`);
    await sql`delete from customer_order_links where account_id in (select id from customer_accounts where phone_e164 = any(${e164}))`;
    await sql`delete from customer_sessions where account_id in (select id from customer_accounts where phone_e164 = any(${e164}))`;
    await sql`delete from customer_favorites where account_id in (select id from customer_accounts where phone_e164 = any(${e164}))`;
    await sql`delete from customer_addresses where account_id in (select id from customer_accounts where phone_e164 = any(${e164}))`;
    await sql`update customer_accounts set phone_e164 = null, deleted_at = now() where phone_e164 = any(${e164})`;
    await sql`delete from rate_limit_buckets where scope like 'customer_%'`;
    await sql`update product_variants set price_agorot = 700 where domain_id = 'general-cleaner--default'`;
  });
}

test.beforeAll(cleanUp);
test.afterAll(cleanUp);

async function signIn(page: Page, phone: string, next = "") {
  await page.goto(`/account${next ? `?next=${next}` : ""}`);
  await page.getByLabel("الرقم المحلي").fill(phone);
  await page.getByRole("button", { name: "إرسال رمز التحقق" }).click();
  await page.getByLabel("رمز التحقق").fill(CODE);
  await page.getByRole("button", { name: "تأكيد الدخول" }).click();
}

async function addToCart(page: Page, productId: string) {
  const product = page.locator(`[data-product-id="${productId}"]`);
  await expect(async () => {
    await product.getByRole("button", { name: "أضف إلى السلة" }).click();
    await expect(page.locator(".cart-button")).toHaveAccessibleName(
      /عدد المنتجات [1-9]/,
      { timeout: 2_000 },
    );
  }).toPass();
}

async function placeOrder(page: Page, phone: string) {
  await page.goto("/checkout");
  await page.getByLabel("الاسم الكامل").fill("زبون الحسابات");
  await page.getByLabel("الرقم المحلي").fill(phone);
  await page
    .getByLabel("العنوان بالتفصيل أو أقرب نقطة دالة")
    .fill("ميثلون الحي الغربي قرب المدرسة");
  await page.getByRole("button", { name: /تأكيد الطلب|إرسال الطلب/ }).click();
  await expect(page).toHaveURL(/\/orders\/.+\/confirmation/);
}

test("guest orders without any account step, then sees an optional suggestion", async ({
  page,
}) => {
  const issues = trackPageIssues(page);
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/");
  await addToCart(page, "general-cleaner");
  await page.goto("/checkout");
  await expect(page.getByText("يمكنك الطلب كضيف مباشرة")).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await placeOrder(page, PHONES[0]!);
  const suggestion = page.locator(".account-suggestion");
  await expect(suggestion).toContainText("أنشئ حساباً لحفظ المفضلة");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
  expect(issues.consoleErrors).toEqual([]);
  expect(issues.failedRequests).toEqual([]);
});

test("sign-in rejects a wrong code, then issues an HttpOnly session and claims past orders", async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/account");
  await expect(page.getByRole("link", { name: "متابعة كضيف" })).toBeVisible();
  await page.screenshot({
    path: "artifacts/customer-accounts/login-390.png",
    fullPage: true,
  });
  await page.getByLabel("الرقم المحلي").fill(PHONES[0]!);
  await page.getByRole("button", { name: "إرسال رمز التحقق" }).click();
  await page.getByLabel("رمز التحقق").fill("111111");
  await page.getByRole("button", { name: "تأكيد الدخول" }).click();
  await expect(page.locator(".account-message")).toHaveText(
    "الرمز غير صحيح أو انتهت صلاحيته.",
  );
  await page.getByLabel("رمز التحقق").fill(CODE);
  await page.getByRole("button", { name: "تأكيد الدخول" }).click();
  await expect(page.getByRole("heading", { name: "بياناتي" })).toBeVisible();
  await page.screenshot({
    path: "artifacts/customer-accounts/dashboard-390.png",
    fullPage: true,
  });

  // Development uses a plain name; a production build uses a Secure __Host- cookie.
  const session = (await context.cookies()).find((cookie) =>
    ["souq_customer_session", "__Host-souq-customer"].includes(cookie.name),
  );
  expect(session).toMatchObject({ httpOnly: true, sameSite: "Lax" });
  if (session!.name.startsWith("__Host-")) {
    expect(session).toMatchObject({ secure: true, path: "/" });
  }
  expect(
    await page.evaluate(() => JSON.stringify(window.localStorage)),
  ).not.toContain(session!.value);

  await page.getByRole("link", { name: "طلباتي" }).click();
  await expect(
    page.getByText(/وجدنا طلبات سابقة أُرسلت من رقم جوالك المؤكد \(\d+\)/),
  ).toBeVisible();
  await page.getByRole("button", { name: "إضافة الطلبات إلى حسابي" }).click();
  await expect(
    page.getByText(/أضفنا الطلبات السابقة إلى حسابك \(\d+\)/),
  ).toBeVisible();
  await expect(page.locator(".order-history > li").first()).toBeVisible();
  await page.screenshot({
    path: "artifacts/customer-accounts/orders-390.png",
    fullPage: true,
  });
  await expectNoHorizontalOverflow(page);
});

test("reorder shows current prices before adding to the cart", async ({
  page,
}) => {
  await signIn(page, PHONES[0]!, "/account/orders");
  await expect(page).toHaveURL(/\/account\/orders/);
  await withTestDb(
    (sql) =>
      sql`update product_variants set price_agorot = 950 where domain_id = 'general-cleaner--default'`,
  );
  await page.getByRole("button", { name: "إعادة الطلب" }).first().click();
  const review = page.getByRole("region", { name: "مراجعة إعادة الطلب" });
  await expect(review).toContainText("السعر تغيّر من");
  await expect(review).toContainText("9.5 ₪");
  await review
    .getByRole("button", { name: /أضف المنتجات المتوفرة للسلة/ })
    .click();
  await expect(page).toHaveURL(/\/cart/);
  await expect(page.getByText("9.5 ₪").first()).toBeVisible();
});

test("guest favourites merge into the account only when the customer asks", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page
    .getByRole("button", { name: /إضافة مبيض Dolphin إلى المفضلة/ })
    .click();
  await page.goto("/favorites");
  await expect(page.locator(".results-count")).toHaveText("منتج واحد");
  await expect(page.getByRole("link", { name: "سجّل الدخول" })).toBeVisible();

  await signIn(page, PHONES[1]!, "/favorites");
  await expect(page).toHaveURL(/\/favorites/);
  const prompt = page.locator(".account-suggestion");
  await expect(prompt).toContainText("محفوظة على هذا الجهاز فقط");
  await page.screenshot({
    path: "artifacts/customer-accounts/favorites-merge-390.png",
    fullPage: true,
  });
  await expect(page.locator(".empty-state")).toBeVisible();
  await prompt.getByRole("button", { name: "إضافة إلى حسابي" }).click();
  await expect(prompt).toContainText("أضفنا منتجات هذا الجهاز إلى مفضلتك (1)");
  await expect(
    page.locator("[data-product-id='dolphin-bleach']"),
  ).toBeVisible();

  await page.reload();
  await expect(
    page.locator("[data-product-id='dolphin-bleach']"),
  ).toBeVisible();
  await expect(page.locator(".account-suggestion")).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
});

test("a second customer sees none of the first customer's data", async ({
  page,
}) => {
  await signIn(page, PHONES[2]!, "/account/orders");
  await expect(page.getByText("لا توجد طلبات بعد")).toBeVisible();
  await expect(page.getByText(/طلبات سابقة برقمك/)).toHaveCount(0);
  await page.goto("/favorites");
  await expect(page.locator(".empty-state")).toBeVisible();
});

test("profile, default address prefill and account deletion", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await signIn(page, PHONES[3]!);
  await page.getByLabel("الاسم").fill("ليلى");
  await page.getByRole("button", { name: "حفظ البيانات" }).click();
  await expect(page.getByText("تم حفظ البيانات.")).toBeVisible();
  await page.getByLabel("اسم العنوان").fill("البيت");
  await page
    .getByLabel("العنوان بالتفصيل")
    .fill("ميثلون الحي الشرقي بجانب الصيدلية");
  await page.getByRole("button", { name: "إضافة العنوان" }).click();
  await expect(page.getByText("الافتراضي")).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.goto("/");
  await addToCart(page, "carpet-brush");
  await page.goto("/checkout");
  await expect(page.getByLabel("الاسم الكامل")).toHaveValue("ليلى");
  await expect(page.getByLabel("الرقم المحلي")).toHaveValue("0597001004");
  await expect(
    page.getByLabel("العنوان بالتفصيل أو أقرب نقطة دالة"),
  ).toHaveValue("ميثلون الحي الشرقي بجانب الصيدلية");
  await page.getByLabel("الاسم الكامل").fill("ليلى أحمد");
  await expect(page.getByLabel("الاسم الكامل")).toHaveValue("ليلى أحمد");

  await page.goto("/account");
  await page.getByText("حذف الحساب").click();
  await page.getByLabel("اكتب «حذف» للتأكيد").fill("حذف");
  await page.getByRole("button", { name: "حذف حسابي نهائياً" }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto("/account");
  await expect(
    page.getByRole("button", { name: "إرسال رمز التحقق" }),
  ).toBeVisible();
});
