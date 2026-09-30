import { describe, expect, it } from "vitest";

import { detectAudioType } from "./audio-type";
import {
  toVoiceCommand,
  voiceInterpretationSchema,
  type VoiceInterpretation,
} from "./voice-command";

const base: VoiceInterpretation = {
  intent: "unknown",
  customerName: null,
  supplierName: null,
  items: [],
  payment: null,
  amount: null,
  adjustmentReason: null,
  reportMetric: null,
  period: null,
  clarification: null,
};
const item = (
  overrides: Partial<VoiceInterpretation["items"][number]> = {},
) => ({
  name: "جلي",
  quantity: "2",
  unit: null,
  unitPrice: null,
  ...overrides,
});

describe("voiceInterpretationSchema", () => {
  it("rejects unknown intents and extra fields", () => {
    expect(
      voiceInterpretationSchema.safeParse({ ...base, intent: "delete_all" })
        .success,
    ).toBe(false);
    expect(
      voiceInterpretationSchema.safeParse({ ...base, totalAgorot: 5 }).success,
    ).toBe(false);
    expect(voiceInterpretationSchema.safeParse(base).success).toBe(true);
  });
});

describe("toVoiceCommand", () => {
  it("builds a cash sale with integer quantities and no model-provided totals", () => {
    expect(
      toVoiceCommand({ ...base, intent: "create_sale", items: [item()] }),
    ).toEqual({
      intent: "create_sale",
      customerName: null,
      items: [
        {
          name: "جلي",
          quantityMilli: 2_000,
          unit: null,
          unitPriceAgorot: null,
        },
      ],
      payment: "full",
      paidAgorot: null,
    });
  });

  it("defaults a named customer without a payment word to credit", () => {
    const command = toVoiceCommand({
      ...base,
      intent: "create_sale",
      customerName: " أحمد ",
      items: [item({ quantity: null })],
    });
    expect(command).toMatchObject({
      customerName: "أحمد",
      payment: "none",
      items: [{ quantityMilli: 1_000 }],
    });
  });

  it("asks instead of guessing when a partial payment has no amount", () => {
    expect(
      toVoiceCommand({
        ...base,
        intent: "create_sale",
        items: [item()],
        payment: "partial",
      }),
    ).toMatchObject({ intent: "unknown", question: "كم دفع الزبون؟" });
  });

  it("refuses unreadable quantities and prices", () => {
    expect(
      toVoiceCommand({
        ...base,
        intent: "create_sale",
        items: [item({ quantity: "كثير" })],
      }).intent,
    ).toBe("unknown");
    expect(
      toVoiceCommand({
        ...base,
        intent: "create_sale",
        items: [item({ quantity: "-2" })],
      }).intent,
    ).toBe("unknown");
    expect(
      toVoiceCommand({
        ...base,
        intent: "record_purchase",
        items: [item({ unitPrice: "abc" })],
      }).intent,
    ).toBe("unknown");
  });

  it("requires a customer and a positive amount for a payment", () => {
    expect(
      toVoiceCommand({ ...base, intent: "record_payment", amount: "20" })
        .intent,
    ).toBe("unknown");
    expect(
      toVoiceCommand({
        ...base,
        intent: "record_payment",
        customerName: "أحمد",
        amount: "0",
      }).intent,
    ).toBe("unknown");
    expect(
      toVoiceCommand({
        ...base,
        intent: "record_payment",
        customerName: "أحمد",
        amount: "20",
      }),
    ).toEqual({
      intent: "record_payment",
      customerName: "أحمد",
      amountAgorot: 2_000,
    });
  });

  it("requires exactly one item and a reason for a stock adjustment", () => {
    expect(
      toVoiceCommand({ ...base, intent: "adjust_stock", items: [item()] })
        .intent,
    ).toBe("unknown");
    expect(
      toVoiceCommand({
        ...base,
        intent: "adjust_stock",
        items: [item()],
        adjustmentReason: "damaged",
      }),
    ).toMatchObject({ intent: "adjust_stock", reason: "damaged" });
  });

  it("defaults report questions to weekly sales", () => {
    expect(toVoiceCommand({ ...base, intent: "query_report" })).toEqual({
      intent: "query_report",
      metric: "sales",
      period: "week",
    });
  });
});

describe("detectAudioType", () => {
  const bytes = (head: number[]) =>
    Uint8Array.from([...head, ...new Array(16).fill(0)]);

  it("identifies recorder containers from their signature", () => {
    expect(detectAudioType(bytes([0x1a, 0x45, 0xdf, 0xa3]))?.extension).toBe(
      "webm",
    );
    expect(
      detectAudioType(bytes([0, 0, 0, 0x1c, 0x66, 0x74, 0x79, 0x70]))
        ?.extension,
    ).toBe("m4a");
    expect(detectAudioType(bytes([0x4f, 0x67, 0x67, 0x53]))?.extension).toBe(
      "ogg",
    );
  });

  it("rejects other content regardless of its label", () => {
    expect(detectAudioType(bytes([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
    expect(detectAudioType(Uint8Array.from([0x1a, 0x45]))).toBeNull();
  });
});
