import { toLatinDigits } from "./digits";

export const MAX_MONEY_AGOROT = 10_000_000;
export const PRICE_CLARIFICATION = "ما قدرت أحدد السعر. اكتبه مثلاً: 15 شيكل.";

export type MoneyInputError =
  | "price_missing"
  | "price_invalid"
  | "price_ambiguous"
  | "price_negative"
  | "price_zero"
  | "price_precision"
  | "price_out_of_range";

export type MoneyInputResult =
  { ok: true; agorot: number } | { ok: false; code: MoneyInputError };

const CURRENCY =
  /₪|\bnis\b|\bils\b|شيكلات|شيكل|شيقل|شواكل|ش\.ج|(?:^|\s|(?<=\d))ش(?=\s|$)/giu;

const UNITS: Record<string, number> = {
  واحد: 1,
  وحده: 1,
  اثنين: 2,
  اتنين: 2,
  ثنتين: 2,
  اثنان: 2,
  ثلاث: 3,
  ثلاثه: 3,
  تلات: 3,
  تلاته: 3,
  اربع: 4,
  اربعه: 4,
  خمس: 5,
  خمسه: 5,
  ست: 6,
  سته: 6,
  سبع: 7,
  سبعه: 7,
  ثمان: 8,
  ثماني: 8,
  ثمانيه: 8,
  تمن: 8,
  تمنيه: 8,
  تسع: 9,
  تسعه: 9,
};

const TEENS: Record<string, number> = {
  عشر: 10,
  عشره: 10,
  احدعش: 11,
  حدعش: 11,
  اطنعش: 12,
  اتنعش: 12,
  اثنعش: 12,
  ثنعش: 12,
  تلتعش: 13,
  ثلطعش: 13,
  تلطعش: 13,
  ثلاثطعش: 13,
  اربعتعش: 14,
  اربعطعش: 14,
  خمستعش: 15,
  خمسطعش: 15,
  ستعش: 16,
  سطعش: 16,
  سبعتعش: 17,
  سبعطعش: 17,
  تمنتعش: 18,
  ثمنطعش: 18,
  تمنطعش: 18,
  تسعتعش: 19,
  تسعطعش: 19,
};

const TENS: Record<string, number> = {
  عشرين: 20,
  ثلاثين: 30,
  تلاتين: 30,
  اربعين: 40,
  خمسين: 50,
  ستين: 60,
  سبعين: 70,
  ثمانين: 80,
  تمانين: 80,
  تسعين: 90,
};

const HUNDREDS: Record<string, number> = {
  ميه: 100,
  مئه: 100,
  ميتين: 200,
  مئتين: 200,
  مئتان: 200,
  تلتميه: 300,
  ثلاثميه: 300,
  اربعميه: 400,
  خمسميه: 500,
  ستميه: 600,
  سبعميه: 700,
  تمنميه: 800,
  ثمانميه: 800,
  تسعميه: 900,
};

function normalizeWords(input: string): string {
  return input
    .normalize("NFKC")
    .replace(/[ً-ْٰـ]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ئ/g, "ي")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

const isKnownWord = (token: string) =>
  token === "صفر" ||
  token in UNITS ||
  token in TEENS ||
  token in TENS ||
  token in HUNDREDS ||
  token === "احد";

// "خمسه عشر", "خمسه وعشرين", "ميه وخمسين", "عشره ونص". Unknown words make the whole input invalid.
function parseWords(text: string): number | null {
  const tokens = text
    .split(" ")
    .map((token) =>
      isKnownWord(token) ? token : token.replace(/^و(?=.{2,})/, ""),
    )
    .filter(Boolean);
  if (!tokens.length || tokens.length > 6) return null;

  let total = 0;
  let index = 0;
  let half = false;
  const take = () => tokens[index];

  if (
    take() &&
    take() in UNITS &&
    tokens[index + 1] &&
    /^(ميه|مئه)$/.test(tokens[index + 1]!)
  ) {
    total += UNITS[take()!]! * 100;
    index += 2;
  } else if (take() && take()! in HUNDREDS) {
    total += HUNDREDS[take()!]!;
    index += 1;
  }

  const rest = tokens.slice(index).filter((token) => {
    if (token === "نص" || token === "نصف") {
      half = true;
      return false;
    }
    return true;
  });
  if (rest.length === 1 && rest[0] === "صفر" && index === 0 && !half) {
    return 0;
  }
  if (rest.length === 1) {
    const [word] = rest as [string];
    const value = UNITS[word] ?? TEENS[word] ?? TENS[word];
    if (value === undefined) return null;
    total += value;
  } else if (rest.length === 2) {
    const [first, second] = rest as [string, string];
    if (first in UNITS && (second === "عشر" || second === "عشره")) {
      total += UNITS[first]! + 10;
    } else if (first === "احد" && second === "عشر") {
      total += 11;
    } else if ((first === "اثنا" || first === "اثني") && second === "عشر") {
      total += 12;
    } else if (first in UNITS && second in TENS) {
      total += UNITS[first]! + TENS[second]!;
    } else {
      return null;
    }
  } else if (rest.length > 2) {
    return null;
  } else if (index === 0 && !half) {
    return null;
  }

  return total * 100 + (half ? 50 : 0);
}

function parseDigits(text: string): MoneyInputResult | null {
  const match = /^(\d+)(?:([.,])(\d+))?$/.exec(text);
  if (!match) return null;
  const [, whole, separator, fraction] = match;
  if (separator === "," && fraction?.length === 3) {
    return { ok: false, code: "price_ambiguous" };
  }
  if (fraction && fraction.length > 2) {
    return { ok: false, code: "price_precision" };
  }
  const agorot = Number(whole) * 100 + Number((fraction ?? "").padEnd(2, "0"));
  return Number.isSafeInteger(agorot) ? { ok: true, agorot } : null;
}

export function parseMoneyInput(
  input: string,
  options: { allowZero?: boolean } = {},
): MoneyInputResult {
  const latin = toLatinDigits(input.normalize("NFKC")).replace(/٫/g, ".");
  let text = normalizeWords(latin)
    .replace(CURRENCY, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return { ok: false, code: "price_missing" };
  // "سالب 5", "-5", "ناقص خمسه", "خمسه بالسالب": a sign word anywhere makes the amount negative.
  if (/^(-|ناقص)|سالب/.test(text)) return { ok: false, code: "price_negative" };
  text = text.replace(/\s*([.,])\s*/g, "$1");
  if ((text.match(/\d+(?:[.,]\d+)?/g) ?? []).length > 1) {
    return { ok: false, code: "price_ambiguous" };
  }

  let result: MoneyInputResult;
  if (/\d/.test(text)) {
    const digits = parseDigits(text);
    if (!digits) return { ok: false, code: "price_ambiguous" };
    result = digits;
  } else {
    const agorot = parseWords(text);
    if (agorot === null) return { ok: false, code: "price_invalid" };
    result = { ok: true, agorot };
  }
  if (!result.ok) return result;
  if (result.agorot > MAX_MONEY_AGOROT) {
    return { ok: false, code: "price_out_of_range" };
  }
  if (result.agorot === 0 && !options.allowZero) {
    return { ok: false, code: "price_zero" };
  }
  return result;
}

// Normalized word tokens that can be part of a spoken amount ("خمسه", "وعشرين", "ونص").
export function isAmountWord(token: string): boolean {
  const word = normalizeWords(token);
  const bare = isKnownWord(word) ? word : word.replace(/^و(?=.{2,})/, "");
  return isKnownWord(bare) || bare === "نص" || bare === "نصف";
}

export { normalizeWords as normalizeAmountText };

export const moneyInputMessages: Record<MoneyInputError, string> = {
  price_missing: PRICE_CLARIFICATION,
  price_invalid: PRICE_CLARIFICATION,
  price_ambiguous:
    "في السعر أكثر من رقم أو صيغة غير واضحة. اكتبه مثلاً: 15 شيكل.",
  price_negative: "السعر لازم يكون أكبر من صفر.",
  price_zero: "السعر لازم يكون أكبر من صفر.",
  price_precision: "السعر يقبل خانتين عشريتين فقط، مثلاً 10.50 شيكل.",
  price_out_of_range: "السعر أكبر من الحد المسموح.",
};
