import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { expectNoHorizontalOverflow, withTestDb } from "./support";

const pages = [
  ["/about", "عن MAYTHA", "About MAYTHA"],
  ["/contact", "تواصل معنا", "Contact us"],
  ["/delivery", "التوصيل", "Delivery"],
  ["/returns", "المنتجات التالفة أو الخاطئة", "Damaged or incorrect items"],
  ["/privacy", "الخصوصية", "Privacy"],
  ["/terms", "الشروط", "Terms"],
] as const;

test("every information page exists in Arabic and English, accessible and without overflow", async ({
  page,
}) => {
  for (const [path, arabic, english] of pages) {
    for (const [address, title] of [
      [path, arabic],
      [`/en${path}`, english],
    ] as const) {
      const response = await page.goto(address);
      expect(response?.status(), address).toBe(200);
      await expect(
        page.getByRole("heading", { level: 1, name: title }),
      ).toBeVisible();
      await expectNoHorizontalOverflow(page);
      const axe = await new AxeBuilder({ page })
        .include("main")
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();
      expect(axe.violations.map((violation) => violation.id)).toEqual([]);
    }
  }
  await page.goto("/delivery");
  await page.screenshot({
    path: "artifacts/info-pages/delivery-ar-390.png",
    fullPage: true,
  });
});

test("the pages state the approved policies and the same amounts checkout charges", async ({
  page,
}) => {
  await page.goto("/delivery");
  const main = page.locator("main");
  await expect(main).toContainText("50 ₪");
  await expect(main).toContainText("5 ₪");
  await expect(main).toContainText("داخل ميثلون فقط");
  await expect(main).toContainText("طوال أيام الأسبوع");
  await page.goto("/en/returns");
  await expect(page.locator("main")).toContainText("within 24 hours");
  await expect(page.locator("main")).toContainText(
    "doesn't limit any rights you have under the law",
  );
  await page.goto("/en/terms");
  await expect(page.locator("main")).toContainText(
    "before it leaves for delivery",
  );
  await expect(page.locator("main")).toContainText(
    "never swap it for another without your agreement",
  );
  // Nothing the owner hasn't approved or we haven't verified.
  for (const path of [
    "/en/about",
    "/en/contact",
    "/en/delivery",
    "/en/returns",
    "/en/privacy",
    "/en/terms",
  ]) {
    await page.goto(path);
    await expect(page.locator("main")).not.toContainText(
      /refund|guarantee|authori[sz]ed|official dealer|never sell|encrypt|certif|Vercel|Supabase|[0-9]{1,2}:[0-9]{2}|@/i,
    );
  }
});

test("the official store WhatsApp appears on the contact page, the footer and the policies only once configured", async ({
  page,
}) => {
  // Without a configured number the policies point to the order conversation.
  await page.goto("/contact");
  await expect(page.locator(".info-whatsapp")).toHaveCount(0);
  await expect(page.locator(".store-footer-whatsapp")).toHaveCount(0);
  await page.goto("/en/returns");
  await expect(page.locator("main")).toContainText(
    "in the WhatsApp conversation for your order",
  );

  // A placeholder number, never the store's real one; links are read, not opened.
  await withTestDb(
    (sql) =>
      sql`insert into store_settings (key, value) values ('store_whatsapp_e164', '"+972590000000"') on conflict (key) do update set value = excluded.value`,
  );
  try {
    for (const [path, cta] of [
      ["/contact", "راسلنا على واتساب"],
      ["/en/contact", "Message us on WhatsApp"],
    ] as const) {
      await page.goto(path);
      const block = page.locator(".info-whatsapp");
      await expect(block).toContainText("+972 590000000");
      await expect(block.getByRole("link", { name: cta })).toHaveAttribute(
        "href",
        "https://wa.me/972590000000",
      );
      await expect(page.locator(".store-footer-whatsapp")).toHaveAttribute(
        "href",
        "https://wa.me/972590000000",
      );
      await expectNoHorizontalOverflow(page);
    }
    await page.goto("/");
    await expect(page.locator(".store-footer-whatsapp")).toContainText(
      "+972 590000000",
    );
    for (const path of ["/en/returns", "/en/terms", "/en/privacy"]) {
      await page.goto(path);
      await expect(page.locator("main")).toContainText(
        "on the store's WhatsApp number +972 590000000",
      );
    }
    await page.goto("/returns");
    await expect(page.locator("main")).toContainText("على رقم واتساب المتجر");
    // Only one store number exists anywhere on the page.
    const numbers = await page
      .locator("body")
      .evaluate(
        (body) =>
          (body as HTMLElement).innerText.match(/\+97[02] ?5\d{8}/g) ?? [],
      );
    expect(new Set(numbers)).toEqual(new Set(["+972 590000000"]));
  } finally {
    await withTestDb(
      (sql) =>
        sql`delete from store_settings where key = 'store_whatsapp_e164'`,
    );
  }
});
