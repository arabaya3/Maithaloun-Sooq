import { describe, expect, it } from "vitest";

import {
  confirmationButtonHint,
  isBareAffirmation,
  isExecutionDemand,
} from "./affirmation";

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

describe("isExecutionDemand", () => {
  it("recognises demands to go ahead that add nothing new", () => {
    for (const text of [
      "قلتلك نعم، نفذي هلق وقوليلي لما يخلص",
      "اكدي العملية",
      "نفذيها",
    ]) {
      expect(isExecutionDemand(text)).toBe(true);
    }
  });

  it("leaves new requests alone", () => {
    for (const text of [
      "نعم، وخلي السعر 7 شيكل",
      "غيري سعر المبيض لـ ٩",
      "يلا غيري اسم المبيض لمبيض قوي",
      "ابحث عن فينيسيا",
    ]) {
      expect(isExecutionDemand(text)).toBe(false);
    }
  });
});
