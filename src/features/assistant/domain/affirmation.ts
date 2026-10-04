import { normalizeArabicText } from "@/shared/lib/normalize-arabic";

// Short replies that mean "go ahead". Typing them never executes anything; only the card button does.
const AFFIRMATIONS = new Set(
  [
    "نعم",
    "ايوه",
    "ايوا",
    "اه",
    "آه",
    "اكيد",
    "أكيد",
    "تمام",
    "موافق",
    "موافقة",
    "اوكي",
    "أوكي",
    "يلا",
    "نفذ",
    "نفذي",
    "أكد",
    "اكد",
    "أكدي",
    "اكدي",
    "ok",
    "okay",
    "yes",
  ].map((word) => normalizeArabicText(word)),
);

export function isBareAffirmation(text: string): boolean {
  const words = normalizeArabicText(
    text.replace(/[؟?!.,،:؛\u{1F44D}\u{2705}]/gu, " "),
  )
    .split(" ")
    .filter(Boolean);
  if (!words.length || words.length > 3) return false;
  return words.every((word) => AFFIRMATIONS.has(word));
}

export function confirmationButtonHint(confirmLabel: string): string {
  return `الكتابة في المحادثة لا تنفّذ العملية. للتنفيذ اضغطي زر «${confirmLabel}» في البطاقة أعلاه بعد مراجعتها.`;
}
