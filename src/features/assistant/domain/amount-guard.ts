import { toLatinDigits } from "@/shared/lib/digits";
import {
  isAmountWord,
  normalizeAmountText,
  parseMoneyInput,
} from "@/shared/lib/money-input";

// What the owner actually typed decides whether an amount is usable; the model's arguments are never trusted for this.

export interface StatedAmount {
  agorot: number;
  /** Written with ₪ / شيكل / ش next to it. */
  currency: boolean;
  negative: boolean;
  /** The old value in "12 بدل 10"; named, but not offered as an alternative. */
  replaced: boolean;
}

export interface AmountAnalysis {
  amounts: StatedAmount[];
  /** Two or more different values offered as alternatives ("50، لا 70", "50 ولا 70"). */
  conflicting: boolean;
  negative: boolean;
  uncertain: boolean;
}

const CURRENCY = new Set([
  "₪",
  "شيكل",
  "شيقل",
  "شواكل",
  "شيكلات",
  "ش",
  "nis",
  "ils",
]);
// A number followed by one of these is a size, count or percentage, not money.
const NOT_MONEY = new Set([
  "مل",
  "ملي",
  "ميلي",
  "لتر",
  "ليتر",
  "غرام",
  "غم",
  "جرام",
  "كيلو",
  "كغ",
  "كغم",
  "سم",
  "متر",
  "حبه",
  "حبات",
  "قطعه",
  "قطع",
  "كرتونه",
  "كراتين",
  "علبه",
  "علب",
  "عبوه",
  "عبوات",
  "%",
  "بالميه",
  "بالمئه",
  "مره",
  "مرات",
  "يوم",
  "ايام",
  "شهر",
]);
const ALTERNATIVE = new Set(["لا", "ولا", "او", "بل", "يعني"]);
const UNCERTAIN =
  /مش متاكد|مش متاكده|ما بعرف|مش عارف|مش عارفه|تقريبا|حوالي|يمكن|بالزبط مش/;

function tokenize(text: string): string[] {
  const normalized = normalizeAmountText(
    toLatinDigits(text.normalize("NFKC")).replace(/٫/g, "."),
  );
  return normalized
    .replace(/₪/g, " ₪ ")
    .replace(/(\d)(?=[؀-ۿ])/g, "$1 ")
    .replace(/[،؛!؟?:«»"()]/g, " ")
    .replace(/(^|\s)[.,](?=\s|$)/g, " ")
    .replace(/(\D)[.,](?=\s|$)/g, "$1 ")
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => {
      // "بعشره", "ب12", "ل15": a leading preposition hides the amount.
      const bare = /^(?:بال|ب|ل)(.+)$/.exec(token)?.[1];
      return bare &&
        token !== "بالسالب" &&
        !NOT_MONEY.has(token) &&
        (/^-?\d/.test(bare) || isAmountWord(bare))
        ? bare
        : token;
    });
}

const HALF_ONLY = /^(?:و?نص|و?نصف)(?: (?:و?نص|و?نصف))*$/;

const isIdentifier = (token: string) =>
  /[a-z]/i.test(token) ||
  /\d-\d|[a-z]-|-[a-z]/i.test(token) ||
  /^\d{7,}$/.test(token);

export function analyzeAmounts(text: string): AmountAnalysis {
  const tokens = tokenize(text);
  const amounts: StatedAmount[] = [];
  let alternative = false;
  let index = 0;
  while (index < tokens.length) {
    const token = tokens[index]!;
    if (ALTERNATIVE.has(token)) alternative = true;
    const digit = /^(-?)(\d+(?:[.,]\d+)?)$/.exec(token);
    let phrase: string | null = null;
    let end = index;
    let signed = false;
    if (digit && !isIdentifier(token)) {
      phrase = digit[2]!;
      signed = digit[1] === "-";
      end = index + 1;
    } else if (isAmountWord(token)) {
      end = index;
      while (end < tokens.length && isAmountWord(tokens[end]!)) end += 1;
      phrase = tokens.slice(index, end).join(" ");
      if (HALF_ONLY.test(phrase)) phrase = null;
    }
    if (phrase === null) {
      index += 1;
      continue;
    }
    const next = tokens[end];
    const previous = tokens[index - 1];
    if (next && NOT_MONEY.has(next)) {
      index = end;
      continue;
    }
    const parsed = parseMoneyInput(phrase, { allowZero: true });
    if (parsed.ok) {
      amounts.push({
        agorot: parsed.agorot,
        replaced: previous === "بدل" || previous === "بدال",
        currency:
          (next !== undefined && CURRENCY.has(next)) ||
          (previous !== undefined && CURRENCY.has(previous)),
        negative:
          signed ||
          previous === "سالب" ||
          previous === "ناقص" ||
          next === "بالسالب" ||
          next === "سالب" ||
          tokens[end + 1] === "بالسالب",
      });
    }
    index = end;
  }
  const distinct = new Set(
    amounts.filter((row) => !row.replaced).map((row) => row.agorot),
  );
  return {
    amounts,
    conflicting: alternative && distinct.size > 1,
    negative:
      amounts.some((row) => row.negative) ||
      /(^|\s)سالب(\s|$)/.test(tokens.join(" ")),
    uncertain: UNCERTAIN.test(tokens.join(" ")) && amounts.length > 0,
  };
}

export type AmountProblem =
  | "amount_conflict"
  | "amount_negative"
  | "amount_uncertain"
  | "amount_zero"
  | "amount_mismatch";

export const amountProblemMessages: Record<AmountProblem, string> = {
  amount_conflict: "ذكرتِ أكثر من مبلغ. أي مبلغ هو الصحيح؟",
  amount_negative: "المبلغ لازم يكون أكبر من صفر؛ ما بجهّز مبلغاً سالباً.",
  amount_uncertain: "المبلغ مش مؤكد. اكتبي المبلغ الصحيح بالضبط.",
  amount_zero: "المبلغ لازم يكون أكبر من صفر.",
  amount_mismatch:
    "المبلغ في الطلب مختلف عن اللي كتبتيه. اكتبي المبلغ مرة ثانية.",
};

const formatAgorot = (agorot: number) =>
  `${agorot % 100 === 0 ? agorot / 100 : (agorot / 100).toFixed(2)} ₪`;

/**
 * Checks the amounts a tool is about to use against the owner's own message.
 * `supplied` are the raw amount strings the model passed in this call.
 */
export function checkStatedAmounts(
  ownerText: string,
  supplied: readonly string[],
): { problem: AmountProblem; values: string[] } | null {
  if (!supplied.length) return null;
  const stated = analyzeAmounts(ownerText);
  const values = [...new Set(stated.amounts.map((row) => row.agorot))].map(
    formatAgorot,
  );
  if (stated.negative) return { problem: "amount_negative", values };
  if (stated.conflicting) return { problem: "amount_conflict", values };
  if (stated.uncertain) return { problem: "amount_uncertain", values };
  const money = stated.amounts.filter((row) => row.currency);
  if (
    supplied.length === 1 &&
    new Set(money.map((row) => row.agorot)).size > 1
  ) {
    return { problem: "amount_conflict", values };
  }
  for (const raw of supplied) {
    const parsed = parseMoneyInput(raw, { allowZero: true });
    if (!parsed.ok) {
      if (parsed.code === "price_negative") {
        return { problem: "amount_negative", values };
      }
      // Unreadable text ("عشرة دولار") is left to the tool, whose own parser rejects it with a field message.
      continue;
    }
    if (parsed.agorot === 0 && supplied.length === 1) {
      return { problem: "amount_zero", values };
    }
    if (
      supplied.length === 1 &&
      stated.amounts.length > 0 &&
      !stated.amounts.some((row) => row.agorot === parsed.agorot)
    ) {
      return { problem: "amount_mismatch", values };
    }
  }
  return null;
}

// The confirmation layer refuses a card whose source message is ambiguous, whatever the model sent.
export function isAmbiguousSource(ownerText: string): boolean {
  const stated = analyzeAmounts(ownerText);
  return stated.negative || stated.conflicting || stated.uncertain;
}

const MONEY_KEYS = new Set([
  "priceIls",
  "amountIls",
  "paidIls",
  "unitPriceIls",
  "price",
  "openingUnitCost",
]);

// Every amount string anywhere in a tool input (nested lines and variant changes included).
export function suppliedAmounts(input: unknown): string[] {
  const found: string[] = [];
  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
    } else if (value && typeof value === "object") {
      for (const [key, inner] of Object.entries(value)) {
        if (MONEY_KEYS.has(key) && typeof inner === "string") found.push(inner);
        else visit(inner);
      }
    }
  };
  visit(input);
  return found;
}

// Used before the model runs: a message offering two different amounts as alternatives gets one question back.
export function conflictingAmountQuestion(
  ownerText: string,
): { question: string; values: string[] } | null {
  const stated = analyzeAmounts(ownerText);
  if (!stated.conflicting) return null;
  const values = [...new Set(stated.amounts.map((row) => row.agorot))].map(
    formatAgorot,
  );
  return {
    question: `${amountProblemMessages.amount_conflict} (${values.join(" أو ")})`,
    values,
  };
}
