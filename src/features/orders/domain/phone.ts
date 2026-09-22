export const WHATSAPP_COUNTRY_CODES = ["970", "972"] as const;

export type WhatsAppCountryCode = (typeof WHATSAPP_COUNTRY_CODES)[number];

const ARABIC_INDIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const EXTENDED_ARABIC_INDIC_DIGITS = "۰۱۲۳۴۵۶۷۸۹";

function toWesternDigits(value: string): string {
  let result = "";
  for (const character of value) {
    const arabicIndex = ARABIC_INDIC_DIGITS.indexOf(character);
    if (arabicIndex >= 0) {
      result += String(arabicIndex);
      continue;
    }
    const extendedIndex = EXTENDED_ARABIC_INDIC_DIGITS.indexOf(character);
    if (extendedIndex >= 0) {
      result += String(extendedIndex);
      continue;
    }
    result += character;
  }
  return result;
}

function compactPhoneInput(value: string): string {
  return toWesternDigits(value)
    .trim()
    .replace(/[\s\-().]/g, "");
}

function normalizeNationalMobile(national: string): string | null {
  let digits = national;
  if (digits.startsWith("0")) {
    digits = digits.slice(1);
  }
  if (!/^5\d{8}$/.test(digits)) return null;
  return digits;
}

export function normalizeWhatsAppPhone(
  countryCode: WhatsAppCountryCode,
  nationalNumber: string,
): string | null {
  const compact = compactPhoneInput(nationalNumber);
  if (!compact || !/^\d+$/.test(compact)) return null;

  const national = normalizeNationalMobile(compact);
  if (!national) return null;
  return `+${countryCode}${national}`;
}

export function isSupportedWhatsAppE164(value: string): boolean {
  return /^\+(970|972)5\d{8}$/.test(value);
}

export function formatWhatsAppDisplay(e164: string): string {
  if (!isSupportedWhatsAppE164(e164)) return e164;
  const country = e164.slice(1, 4);
  const national = e164.slice(4);
  return `+${country} ${national}`;
}

export function buildWhatsAppContactUrl(
  e164: string,
  publicReference: string,
): string | null {
  if (!isSupportedWhatsAppE164(e164)) return null;
  const digits = e164.slice(1);
  const text = encodeURIComponent(
    `مرحباً، بخصوص طلبك ${publicReference} في سوق ميثلون`,
  );
  return `https://wa.me/${digits}?text=${text}`;
}

/** Accepts a full number for admin search and legacy single-field input. */
export function normalizePalestinianPhone(value: string): string | null {
  const compact = compactPhoneInput(value);
  if (!compact) return null;

  if (/^\+(970|972)5\d{8}$/.test(compact)) {
    return compact;
  }
  if (/^00(970|972)5\d{8}$/.test(compact)) {
    return `+${compact.slice(2)}`;
  }
  if (/^(970|972)5\d{8}$/.test(compact)) {
    return `+${compact}`;
  }

  if (/^05\d{8}$/.test(compact)) {
    return normalizeWhatsAppPhone("970", compact);
  }

  return null;
}
