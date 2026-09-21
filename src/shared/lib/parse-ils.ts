const ILS_PATTERN = /^\d+(?:[.,]\d{1,2})?$/;
const MAX_AGOROT = 10_000_000;

export function parseIlsToAgorot(input: string): number | null {
  const trimmed = input.trim();
  if (!trimmed || !ILS_PATTERN.test(trimmed)) return null;

  const normalized = trimmed.replace(",", ".");
  const [wholePart, fractionPart = ""] = normalized.split(".");
  const agorot = Number(wholePart) * 100 + Number(fractionPart.padEnd(2, "0"));
  if (!Number.isSafeInteger(agorot) || agorot < 0 || agorot > MAX_AGOROT) {
    return null;
  }
  return agorot;
}

export function formatAgorotAsIlsInput(agorot: number): string {
  if (!Number.isSafeInteger(agorot) || agorot < 0) return "";
  const whole = Math.trunc(agorot / 100);
  const fraction = agorot % 100;
  return `${whole}.${String(fraction).padStart(2, "0")}`;
}
