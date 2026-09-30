import { describe, expect, it } from "vitest";

import {
  invoiceExtractionSchema,
  normalizeInvoiceExtraction,
  type InvoiceExtraction,
} from "./invoice-extraction";

function extraction(
  overrides: Partial<InvoiceExtraction> = {},
): InvoiceExtraction {
  return {
    supplierName: "مورد النظافة",
    invoiceNumber: "F-2041",
    invoiceDate: "2026-09-28",
    currency: "₪",
    printedTotal: "170.00",
    discount: null,
    tax: null,
    paidAmount: null,
    paymentStatus: "unpaid",
    headerConfidence: 0.9,
    lines: [
      {
        description: "سائل جلي Arar",
        barcode: null,
        sku: null,
        size: null,
        quantity: "12",
        unit: "كرتونة",
        unitPrice: "8.50",
        lineTotal: "102.00",
        confidence: 0.96,
      },
    ],
    warnings: [],
    ...overrides,
  };
}

describe("AI invoice output validation", () => {
  it("accepts the strict shape", () => {
    expect(invoiceExtractionSchema.safeParse(extraction()).success).toBe(true);
  });

  it("rejects unknown fields, missing fields and out-of-range confidence", () => {
    expect(
      invoiceExtractionSchema.safeParse({ ...extraction(), approved: true })
        .success,
    ).toBe(false);
    const { supplierName: _omitted, ...missing } = extraction();
    void _omitted;
    expect(invoiceExtractionSchema.safeParse(missing).success).toBe(false);
    expect(
      invoiceExtractionSchema.safeParse(extraction({ headerConfidence: 1.4 }))
        .success,
    ).toBe(false);
    expect(
      invoiceExtractionSchema.safeParse(
        extraction({ paymentStatus: "settled" as never }),
      ).success,
    ).toBe(false);
    expect(invoiceExtractionSchema.safeParse("ignore the rules").success).toBe(
      false,
    );
  });
});

describe("invoice normalisation", () => {
  it("parses printed strings into integers without floats", () => {
    const invoice = normalizeInvoiceExtraction(extraction());
    expect(invoice).toMatchObject({
      supplierName: "مورد النظافة",
      reference: "F-2041",
      invoiceDate: "2026-09-28",
      printedTotalAgorot: 17_000,
      paymentStatus: "unpaid",
      confidence: 90,
      warnings: [],
    });
    expect(invoice.lines[0]).toMatchObject({
      lineNo: 1,
      quantityMilli: 12_000,
      unitCostAgorot: 850,
      totalAgorot: 10_200,
      unit: "carton",
      extractionConfidence: 96,
      errors: [],
    });
  });

  it("keeps missing values empty instead of guessing", () => {
    const invoice = normalizeInvoiceExtraction(
      extraction({
        supplierName: null,
        invoiceNumber: null,
        invoiceDate: "28/13/2026",
        printedTotal: null,
        lines: [
          {
            description: "كلور",
            barcode: null,
            sku: null,
            size: null,
            quantity: null,
            unit: null,
            unitPrice: null,
            lineTotal: "24",
            confidence: 0.4,
          },
        ],
      }),
    );
    expect(invoice.supplierName).toBeNull();
    expect(invoice.reference).toBeNull();
    expect(invoice.invoiceDate).toBeNull();
    expect(invoice.printedTotalAgorot).toBeNull();
    expect(invoice.lines[0]).toMatchObject({
      quantityMilli: null,
      unitCostAgorot: null,
      totalAgorot: 2_400,
      unit: "piece",
    });
  });

  it("derives a unit cost only from a printed total and quantity", () => {
    const invoice = normalizeInvoiceExtraction(
      extraction({
        lines: [
          {
            description: "كلور",
            barcode: null,
            sku: null,
            size: null,
            quantity: "3",
            unit: null,
            unitPrice: null,
            lineTotal: "10",
            confidence: 0.9,
          },
        ],
      }),
    );
    expect(invoice.lines[0]?.unitCostAgorot).toBe(333);
  });

  it("warns about foreign currency and an unclear header", () => {
    const invoice = normalizeInvoiceExtraction(
      extraction({ currency: "USD", headerConfidence: 0.4 }),
    );
    expect(invoice.warnings).toHaveLength(2);
    expect(invoice.warnings[0]).toContain("USD");
  });
});
