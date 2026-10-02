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
  if (SUCCESS_CLAIM.test(text)) return "premature_success";
  const known = numbersIn(input.evidence.join(" "));
  for (const match of text.matchAll(FIGURE)) {
    const value = toNumber(match[1] ?? match[2] ?? "");
    if (Number.isFinite(value) && !known.has(String(value))) {
      return "ungrounded_figure";
    }
  }
  return null;
}
