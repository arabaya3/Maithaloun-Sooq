// Small, deterministic readings of a customer message. The decisions that matter
// (confirming an order, handing over to a person) never depend on the AI model.

const DIACRITICS = /[ً-ٰٟـ]/g;

export function normalizeMessage(text: string): string {
  return text
    .normalize("NFKC")
    .replace(DIACRITICS, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function messageLocale(text: string): "ar" | "en" {
  const arabic = (text.match(/[؀-ۿ]/g) ?? []).length;
  const latin = (text.match(/[A-Za-z]/g) ?? []).length;
  return latin > arabic ? "en" : "ar";
}

const AFFIRMATIONS = new Set([
  "نعم",
  "اه",
  "اي",
  "ايوه",
  "ايوا",
  "اكيد",
  "تمام",
  "موافق",
  "اكد",
  "اكدي",
  "ثبت",
  "ثبتي",
  "يلا",
  "ماشي",
  "اوكي",
  "ok",
  "okay",
  "yes",
  "yeah",
  "yep",
  "confirm",
  "confirmed",
  "sure",
]);

/** A short, clear yes. Longer messages go to the assistant instead of confirming an order by accident. */
export function isAffirmation(text: string): boolean {
  const words = normalizeMessage(text).split(" ").filter(Boolean);
  if (!words.length || words.length > 4) return false;
  if (
    words.some((word) =>
      ["لا", "مش", "بلاش", "no", "not", "cancel", "الغي"].includes(word),
    )
  ) {
    return false;
  }
  return words.some((word) => AFFIRMATIONS.has(word));
}

const HUMAN_PATTERNS = [
  /\b(human|agent|person|staff|someone real|representative)\b/,
  /(موظف|انسان|بشري|حدا من المحل|حد من المحل|صاحب المحل|احكي مع حد|احكي مع حدا|بدي احكي|كلمني|اتصل)/,
];

export function asksForHuman(text: string): boolean {
  const normalized = normalizeMessage(text);
  return HUMAN_PATTERNS.some((pattern) => pattern.test(normalized));
}
