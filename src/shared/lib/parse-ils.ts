import { parseMoneyInput } from "./money-input";

// Form and assistant amounts share one parser; zero is allowed here and rejected by callers that need a positive price.
export function parseIlsToAgorot(input: string): number | null {
  const result = parseMoneyInput(input, { allowZero: true });
  return result.ok ? result.agorot : null;
}

export function formatAgorotAsIlsInput(agorot: number): string {
  if (!Number.isSafeInteger(agorot) || agorot < 0) return "";
  const whole = Math.trunc(agorot / 100);
  const fraction = agorot % 100;
  return `${whole}.${String(fraction).padStart(2, "0")}`;
}
