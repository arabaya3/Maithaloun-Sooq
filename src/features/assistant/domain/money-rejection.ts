import { moneyInputMessages, parseMoneyInput } from "@/shared/lib/money-input";

// The parser's own reason, so the owner is told exactly how to write the amount.
export function moneyRejection(input: string | undefined | null) {
  const result = parseMoneyInput(input ?? "");
  const code = result.ok ? "price_invalid" : result.code;
  return {
    status: "rejected" as const,
    code,
    message: moneyInputMessages[code],
  };
}
