import { toLatinDigits } from "@/shared/lib/digits";

export const SMOKE_QUESTIONS = [
  { id: "low-stock", text: "شو المنتجات اللي قربت تخلص؟" },
  { id: "inventory-value", text: "كم قيمة البضاعة الموجودة؟" },
  { id: "sales-today", text: "كم بعت اليوم؟" },
  { id: "profit-week", text: "كم ربحت هذا الأسبوع؟" },
  { id: "debtors", text: "مين عليه ديون؟" },
  { id: "search", text: "ابحث عن فينيسيا" },
] as const;

// Read tools only. No draft, prepare or confirmation tool can be reached from the smoke test.
export const SMOKE_TOOL_ALLOWLIST = [
  "getLowStockItems",
  "getInventorySummary",
  "getSalesSummary",
  "getProfitSummary",
  "getDebtors",
  "searchProducts",
] as const;

export const SMOKE_RATE_LIMIT = {
  scope: "admin_assistant_smoke",
  perHour: 6,
} as const;

export function smokeTestEnabled(
  environment: Readonly<Record<string, string | undefined>>,
): boolean {
  return environment.ASSISTANT_SMOKE_TEST === "on";
}

export function maskName(name: string): string {
  const first = [...name.trim()][0];
  return first ? `${first}•••` : "•••";
}

// Any run of 7+ digits (phones, ids) is cut to its last two digits.
export function maskPrivateText(text: string): string {
  return text.replace(/[+\d٠-٩][\d٠-٩\s-]{6,}[\d٠-٩]/g, (match) => {
    const digits = toLatinDigits(match).replace(/\D/g, "");
    return digits.length >= 7 ? `•••${digits.slice(-2)}` : match;
  });
}

type DebtorsOutput = {
  count: number;
  total: string;
  debtors: Array<{ name: string; balance: string; oldestDebtDays: number }>;
};

// The smoke test shows the debt total and masked names, never who exactly owes what.
export function maskDebtors(output: unknown): unknown {
  if (!output || typeof output !== "object" || !("debtors" in output)) {
    return output;
  }
  const value = output as DebtorsOutput;
  return {
    count: value.count,
    total: value.total,
    debtors: value.debtors.map((row) => ({
      name: maskName(row.name),
      balance: row.balance,
      oldestDebtDays: row.oldestDebtDays,
    })),
  };
}
