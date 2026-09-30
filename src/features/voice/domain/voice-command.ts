import { z } from "zod";

import type { StockUnit } from "@/features/inventory/domain/stock-constants";
import {
  cleanCell,
  parseSpreadsheetMoney,
  parseSpreadsheetQuantity,
  parseUnit,
} from "@/features/purchasing/domain/spreadsheet";

export const voiceIntents = [
  "create_sale",
  "record_payment",
  "record_purchase",
  "adjust_stock",
  "query_report",
  "query_customer_balance",
  "unknown",
] as const;
export type VoiceIntent = (typeof voiceIntents)[number];

export const voiceReportMetrics = [
  "profit",
  "sales",
  "top_product",
  "low_stock",
] as const;
export type VoiceReportMetric = (typeof voiceReportMetrics)[number];

export const voicePeriods = ["today", "week", "last14", "month"] as const;
export type VoicePeriod = (typeof voicePeriods)[number];

export const voiceAdjustmentReasons = [
  "damaged",
  "expired",
  "correction",
] as const;

const nullableText = (max: number) => z.string().max(max).nullable();

// The model's raw answer. It only transcribes intent; every amount is re-parsed and re-priced in code.
export const voiceInterpretationSchema = z
  .object({
    intent: z.enum(voiceIntents),
    customerName: nullableText(100),
    supplierName: nullableText(120),
    items: z
      .array(
        z
          .object({
            name: z.string().max(160),
            quantity: nullableText(20),
            unit: nullableText(20),
            unitPrice: nullableText(20),
          })
          .strict(),
      )
      .max(20),
    payment: z.enum(["full", "none", "partial"]).nullable(),
    amount: nullableText(20),
    adjustmentReason: z.enum(voiceAdjustmentReasons).nullable(),
    reportMetric: z.enum(voiceReportMetrics).nullable(),
    period: z.enum(voicePeriods).nullable(),
    clarification: nullableText(200),
  })
  .strict();
export type VoiceInterpretation = z.infer<typeof voiceInterpretationSchema>;

const nullableString = { type: ["string", "null"] } as const;
const properties = {
  intent: { type: "string", enum: voiceIntents },
  customerName: nullableString,
  supplierName: nullableString,
  items: {
    type: "array",
    items: {
      type: "object",
      additionalProperties: false,
      required: ["name", "quantity", "unit", "unitPrice"],
      properties: {
        name: { type: "string" },
        quantity: nullableString,
        unit: nullableString,
        unitPrice: nullableString,
      },
    },
  },
  payment: {
    type: ["string", "null"],
    enum: ["full", "none", "partial", null],
  },
  amount: nullableString,
  adjustmentReason: {
    type: ["string", "null"],
    enum: [...voiceAdjustmentReasons, null],
  },
  reportMetric: {
    type: ["string", "null"],
    enum: [...voiceReportMetrics, null],
  },
  period: { type: ["string", "null"], enum: [...voicePeriods, null] },
  clarification: nullableString,
} as const;

export const voiceJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: Object.keys(properties),
  properties,
} as const;

export const VOICE_INSTRUCTIONS = [
  "You turn one spoken Arabic sentence from a shopkeeper into a structured command.",
  "Intents: create_sale (sold goods), record_payment (a customer paid a debt), record_purchase (stock bought or added with a cost), adjust_stock (damaged, expired or recount), query_report (profit, sales, best seller, low stock), query_customer_balance (who owes money or how much a customer owes), unknown.",
  "Copy product, customer and supplier names as spoken. Do not match them to any catalog and do not invent names.",
  'Write quantities and amounts as digits in strings (عبوتين -> "2", عشرين -> "20"). Use null when not said.',
  "payment is full when the customer paid everything, none when it goes on their account, partial when part was paid (amount holds what was paid).",
  "Never calculate totals, prices, profit or balances.",
  "If the sentence is unclear, use intent unknown and put one short Arabic question in clarification.",
].join(" ");

export interface VoiceItem {
  name: string;
  quantityMilli: number;
  unit: StockUnit | null;
  unitPriceAgorot: number | null;
}

export type VoiceCommand =
  | {
      intent: "create_sale";
      customerName: string | null;
      items: VoiceItem[];
      payment: "full" | "none" | "partial";
      paidAgorot: number | null;
    }
  | { intent: "record_payment"; customerName: string; amountAgorot: number }
  | {
      intent: "record_purchase";
      supplierName: string | null;
      items: VoiceItem[];
    }
  | {
      intent: "adjust_stock";
      item: VoiceItem;
      reason: (typeof voiceAdjustmentReasons)[number];
    }
  | { intent: "query_report"; metric: VoiceReportMetric; period: VoicePeriod }
  | { intent: "query_customer_balance"; customerName: string | null }
  | { intent: "unknown"; question: string };

const DEFAULT_QUESTION = "لم أفهم العملية. أعيدي قولها بجملة قصيرة.";
const unknown = (question: string | null): VoiceCommand => ({
  intent: "unknown",
  question: question ? cleanCell(question) : DEFAULT_QUESTION,
});

function toItems(raw: VoiceInterpretation["items"]): VoiceItem[] | null {
  const items: VoiceItem[] = [];
  for (const item of raw) {
    const name = cleanCell(item.name);
    const quantityMilli = item.quantity
      ? parseSpreadsheetQuantity(item.quantity)
      : 1_000;
    const unitPriceAgorot = item.unitPrice
      ? parseSpreadsheetMoney(item.unitPrice)
      : null;
    if (!name || quantityMilli === null || quantityMilli <= 0) return null;
    if (item.unitPrice && unitPriceAgorot === null) return null;
    items.push({
      name,
      quantityMilli,
      unit: item.unit ? parseUnit(item.unit) : null,
      unitPriceAgorot,
    });
  }
  return items;
}

// Narrows the flat model output into a command the server is willing to act on.
export function toVoiceCommand(raw: VoiceInterpretation): VoiceCommand {
  const customerName = raw.customerName ? cleanCell(raw.customerName) : null;
  const amountAgorot = raw.amount ? parseSpreadsheetMoney(raw.amount) : null;

  switch (raw.intent) {
    case "create_sale": {
      const items = toItems(raw.items);
      if (!items?.length) return unknown("ما المنتجات التي بعتِها؟");
      const payment = raw.payment ?? (customerName ? "none" : "full");
      if (
        payment === "partial" &&
        (amountAgorot === null || amountAgorot <= 0)
      ) {
        return unknown("كم دفع الزبون؟");
      }
      return {
        intent: "create_sale",
        customerName,
        items,
        payment,
        paidAgorot: payment === "partial" ? amountAgorot : null,
      };
    }
    case "record_payment":
      if (!customerName) return unknown("مَن الزبون الذي دفع؟");
      if (amountAgorot === null || amountAgorot <= 0) {
        return unknown("كم المبلغ الذي دفعه؟");
      }
      return { intent: "record_payment", customerName, amountAgorot };
    case "record_purchase": {
      const items = toItems(raw.items);
      if (!items?.length) return unknown("ما الأصناف التي اشتريتِها؟");
      return {
        intent: "record_purchase",
        supplierName: raw.supplierName ? cleanCell(raw.supplierName) : null,
        items,
      };
    }
    case "adjust_stock": {
      const items = toItems(raw.items);
      if (items?.length !== 1 || !raw.adjustmentReason) {
        return unknown("أي صنف تريدين تعديله، وما السبب؟");
      }
      return {
        intent: "adjust_stock",
        item: items[0]!,
        reason: raw.adjustmentReason,
      };
    }
    case "query_report":
      return {
        intent: "query_report",
        metric: raw.reportMetric ?? "sales",
        period: raw.period ?? "week",
      };
    case "query_customer_balance":
      return { intent: "query_customer_balance", customerName };
    default:
      return unknown(raw.clarification);
  }
}
