import { toLatinDigits } from "@/shared/lib/digits";

export type GroundingViolation = "premature_success" | "ungrounded_figure";

export const GROUNDING_REPLIES: Record<
  GroundingViolation | "premature_success_with_card",
  string
> = {
  premature_success:
    "لم يُنفَّذ أي تعديل. أقدر أجهّز بطاقة تراجعيها وتؤكديها بنفسك.",
  premature_success_with_card:
    "جهّزت البطاقة، ولا شيء يتغيّر قبل أن تضغطي «تأكيد» فيها.",
  ungrounded_figure:
    "ما عندي رقم مؤكد لهذا. اسأليني عن المنتج أو الزبون بالاسم لأبحث عنه أولاً.",
};

// Chat never executes changes; only the card's confirm button does, so any completion claim here is premature.
const SUCCESS_CLAIM =
  /(?:^|[\s،.!؟:])(?:تم|تمت|تمّ|تمّت)\s+(?:ال)?(?:إضافة|اضافة|تعديل|حذف|تسجيل|دفع|تنفيذ|حفظ|بيع|أرشفة|ارشفة|إلغاء|الغاء|نشر|دمج|استرجاع|تحويل)|(?:^|[\s،.!؟:])(?:انضاف|انضافت|انحذف|انحذفت|تعدّل|تعدل|تعدّلت|تعدلت|اتسجل|انسجل|اندفع|اتنفذ|انتشر|اندمج)(?=$|[\s،.!؟:])/u;

const SUCCESS_CLAIMS = new RegExp(SUCCESS_CLAIM.source, "gu");
// "ما بقدر أقول إنه انحذف", "إذا انحذف" or "المبلغ كما اندفع" is not a claim; the particle must sit in the same clause, at most six words before.
const NEGATION_OR_CONDITION =
  /(?:^|\s)(?:ما|مش|مو|لم|لن|لا|ولا|إذا|اذا|لو|قبل|بدون|دون|كما|زي|مثل|متل)(?=\s|$)/u;

// "ما بقدر أقول إنّي حذفته أو إنّو انحذف": a refusal to say it covers the claims that follow in its clause.
const REFUSED_SAYING =
  /(?:^|\s)(?:ما|مش|لا|لن)\s+(?:(?:بقدر|بقدرش|اقدر|أقدر|بستطيع|أستطيع|استطيع|رح|راح|بدي)\s+)?(?:أقول|اقول|بقول|أحكي|احكي|بحكي|أدّعي|أدعي|ادعي)\s+(?:إن|ان|إنه|انه|إنّه|إنّي|اني|إني|إنّو|انو|إنو)/u;

function isClaimed(text: string, index: number): boolean {
  const clause =
    text
      .slice(0, index)
      .split(/[،,.!؟?:\n]/u)
      .at(-1) ?? "";
  if (REFUSED_SAYING.test(clause)) return false;
  const nearby = clause.trim().split(/\s+/u).slice(-6).join(" ");
  return !NEGATION_OR_CONDITION.test(nearby);
}

const NUMBER = String.raw`\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:[.,]\d+)?`;
const FIGURE = new RegExp(
  String.raw`(?:₪\s*(${NUMBER}))|(?:(${NUMBER})\s*(?:₪|شيكل|شيقل|شواكل|ش(?=$|[\s،.!؟])|حبة|حبات|قطعة|قطع|كرتونة|كراتين))`,
  "gu",
);

// "1,250.5" is a grouped thousand; "10,5" is a decimal comma.
function toNumber(raw: string): number {
  return /^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(raw)
    ? Number(raw.replace(/,/g, ""))
    : Number(raw.replace(",", "."));
}

function numbersIn(text: string): Set<string> {
  const found = new Set<string>();
  for (const match of toLatinDigits(text).matchAll(new RegExp(NUMBER, "g"))) {
    const value = toNumber(match[0]);
    if (!Number.isFinite(value)) continue;
    found.add(String(value));
    if (Number.isInteger(value)) found.add(String(value / 100));
  }
  return found;
}

export function checkGrounding(input: {
  text: string;
  evidence: readonly string[];
}): GroundingViolation | null {
  const text = toLatinDigits(input.text);
  for (const match of text.matchAll(SUCCESS_CLAIMS)) {
    if (isClaimed(text, match.index ?? 0)) return "premature_success";
  }
  const known = numbersIn(input.evidence.join(" "));
  for (const match of text.matchAll(FIGURE)) {
    const value = toNumber(match[1] ?? match[2] ?? "");
    if (Number.isFinite(value) && !known.has(String(value))) {
      return "ungrounded_figure";
    }
  }
  return null;
}
