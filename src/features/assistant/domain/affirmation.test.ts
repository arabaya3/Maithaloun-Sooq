import { describe, expect, it } from "vitest";

import { confirmationButtonHint, isBareAffirmation } from "./affirmation";

describe("bare affirmations", () => {
  it.each(["نعم", "نعم!", "أكيد", "تمام نفذي", "اه", "ok", "yes 👍", "أكّدي"])(
    "treats «%s» as a yes that needs the button",
    (text) => {
      expect(isBareAffirmation(text)).toBe(true);
    },
  );

  it.each([
    "نعم غيري السعر إلى 20",
    "لا",
    "",
    "ابحث عن منظف",
    "تمام تمام تمام تمام",
  ])("does not intercept «%s»", (text) => {
    expect(isBareAffirmation(text)).toBe(false);
  });

  it("names the card button in the reply", () => {
    expect(confirmationButtonHint("تأكيد العرض")).toContain("«تأكيد العرض»");
  });
});
