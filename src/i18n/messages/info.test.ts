import { describe, expect, it } from "vitest";

import { catalog } from "./catalog";
import { common } from "./common";
import { info } from "./info";
import { meta } from "./meta";
import { store } from "./store";

const pages = [
  "about",
  "contact",
  "delivery",
  "returns",
  "privacy",
  "terms",
] as const;

const pageText = (locale: "ar" | "en") =>
  pages
    .flatMap((key) =>
      info[locale][key].sections.flatMap((section) => [
        section.title,
        ...section.paragraphs,
      ]),
    )
    .join("\n");

describe("store information pages", () => {
  it("say the same things in Arabic and English", () => {
    for (const key of pages) {
      const ar = info.ar[key].sections;
      const en = info.en[key].sections;
      expect(en.length, key).toBe(ar.length);
      ar.forEach((section, index) =>
        expect(en[index]!.paragraphs.length, `${key} ${index}`).toBe(
          section.paragraphs.length,
        ),
      );
    }
  });

  it("disclose that order records can't currently be deleted, without waiving rights", () => {
    expect(pageText("en")).toContain(
      "can't currently be changed, deleted or de-identified",
    );
    expect(pageText("ar")).toContain(
      "لا يمكن حالياً تعديلها أو حذفها أو إخفاء الهوية فيها",
    );
    expect(pageText("en")).not.toContain("We delete or de-identify");
    expect(pageText("en")).toContain(
      "This technical limitation does not limit any rights you have under applicable law.",
    );
  });

  it("name where data is processed, and the free-delivery basis", () => {
    for (const fragment of [
      "servers in the European Union",
      "external provider in the United States",
      "processed outside Palestine",
      "{free} or more, before delivery",
    ]) {
      expect(pageText("en")).toContain(fragment);
    }
    expect(pageText("ar")).toContain("دون احتساب رسوم التوصيل");
    expect(pageText("ar")).toContain("خارج فلسطين");
  });

  it("make no genuine-product, hours, refund or certification claims anywhere on the storefront", () => {
    const everything = JSON.stringify([
      info,
      common.ar,
      common.en,
      catalog,
      store,
      meta,
    ]);
    // The hero heading «ماركات أصلية / Original Brands» is owner-approved and reviewed separately.
    expect(everything).not.toMatch(
      /منتجات أصلية|genuine|refund|guarantee|certif|never sell|\d{1,2}:\d{2}/i,
    );
  });
});
