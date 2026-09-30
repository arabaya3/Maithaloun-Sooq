const ARABIC_INDIC_ZERO = 0x0660;
const EASTERN_ARABIC_ZERO = 0x06f0;

export function toLatinDigits(input: string): string {
  return input
    .replace(/[٠-٩]/g, (digit) =>
      String(digit.charCodeAt(0) - ARABIC_INDIC_ZERO),
    )
    .replace(/[۰-۹]/g, (digit) =>
      String(digit.charCodeAt(0) - EASTERN_ARABIC_ZERO),
    )
    .replace(/٫/g, ".")
    .replace(/٬/g, "");
}
