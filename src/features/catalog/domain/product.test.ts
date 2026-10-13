import { describe, expect, it } from "vitest";

import { localizedProductName, localizedProductText } from "./product";

describe("localized product text", () => {
  const product = {
    nameAr: "منظف عام",
    latinName: "Secret",
    description: "وصف عربي",
    usageNotes: "ملاحظات",
  };

  it("uses the owner's English only in English", () => {
    const english = {
      ...product,
      nameEn: "Secret Cleaner",
      descriptionEn: "English description",
    };
    expect(localizedProductName(english, "en")).toBe("Secret Cleaner");
    expect(localizedProductName(english, "ar")).toBe("منظف عام Secret");
    expect(localizedProductText(english, "en")).toEqual({
      description: "English description",
      usageNotes: "ملاحظات",
    });
  });

  it("falls back to the original name and text when no English was written", () => {
    expect(localizedProductName(product, "en")).toBe("منظف عام Secret");
    expect(localizedProductText(product, "en")).toEqual({
      description: "وصف عربي",
      usageNotes: "ملاحظات",
    });
  });
});
