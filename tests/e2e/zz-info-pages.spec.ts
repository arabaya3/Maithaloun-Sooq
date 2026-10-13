import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { expectNoHorizontalOverflow, withTestDb } from "./support";

const pages = [
  ["/about", "عن MAYTHA", "About MAYTHA"],
  ["/contact", "تواصل معنا", "Contact us"],
  ["/delivery", "التوصيل", "Delivery"],
  ["/returns", "المنتجات التالفة أو الخاطئة", "Damaged or incorrect items"],
  ["/privacy", "الخصوصية", "Privacy"],
  ["/terms", "الشروط والأحكام", "Terms and conditions"],
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
    "does not limit any rights you have under applicable law",
  );
  await page.goto("/en/terms");
  await expect(page.locator("main")).toContainText(
    "before it leaves for delivery",
  );
  await expect(page.locator("main")).toContainText(
    "never substitute a product without your agreement",
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

test("the contact page links to the store's WhatsApp only when a number is set", async ({
  page,
}) => {
  await page.goto("/contact");
  await expect(
    page.getByRole("link", { name: "راسلنا على واتساب" }),
  ).toHaveCount(0);
  await withTestDb(
    (sql) =>
      sql`insert into store_settings (key, value) values ('store_whatsapp_e164', '"+970590000000"') on conflict (key) do update set value = excluded.value`,
  );
  try {
    await page.goto("/contact");
    await expect(
      page.getByRole("link", { name: "راسلنا على واتساب" }),
    ).toHaveAttribute("href", /^https:\/\/wa\.me\/970590000000/);
  } finally {
    await withTestDb(
      (sql) =>
        sql`delete from store_settings where key = 'store_whatsapp_e164'`,
    );
  }
});
