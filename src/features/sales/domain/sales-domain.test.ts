import { describe, expect, it } from "vitest";

import {
  allocateInvoices,
  ledgerBalance,
  summarizeCustomer,
  type InvoiceForAllocation,
} from "./customer-balance";
import { buildInvoiceShareText, buildWhatsAppShareUrl } from "./invoice-share";
import {
  SaleCalculationError,
  calculateSale,
  saleProfit,
} from "./sale-calculation";
import { buildSalePayload, emptySaleDraft } from "./sale-draft";

const invoice = (
  id: string,
  date: string,
  totalAgorot: number,
  status: "posted" | "cancelled" = "posted",
): InvoiceForAllocation => ({ id, date, totalAgorot, status });

describe("customer balance", () => {
  it("is the sum of the ledger, including reversals", () => {
    expect(
      ledgerBalance([
        { amountAgorot: 5_000 },
        { amountAgorot: -2_000 },
        { amountAgorot: 2_000 },
        { amountAgorot: -5_000 },
      ]),
    ).toBe(0);
  });

  it("settles the oldest invoice first on a partial payment", () => {
    const invoices = [
      invoice("b", "2026-09-10", 3_000),
      invoice("a", "2026-09-01", 2_000),
    ];
    const result = allocateInvoices(invoices, 3_500, "2026-09-12");
    expect(result).toEqual([
      {
        id: "b",
        paidAgorot: 0,
        remainingAgorot: 3_000,
        state: "unpaid",
        ageDays: 2,
      },
      {
        id: "a",
        paidAgorot: 1_500,
        remainingAgorot: 500,
        state: "partially_paid",
        ageDays: 11,
      },
    ]);
  });

  it("marks old open invoices overdue and cancelled invoices cancelled", () => {
    const result = allocateInvoices(
      [
        invoice("old", "2026-08-01", 1_000),
        invoice("void", "2026-08-05", 9_000, "cancelled"),
        invoice("new", "2026-09-20", 1_000),
      ],
      1_000,
      "2026-09-21",
    );
    expect(result.map((item) => item.state)).toEqual([
      "paid",
      "cancelled",
      "unpaid",
    ]);
    const overdue = allocateInvoices(
      [invoice("old", "2026-08-01", 1_000)],
      1_000,
      "2026-09-21",
    );
    expect(overdue[0]?.state).toBe("overdue");
  });

  it("treats a credit balance as everything paid", () => {
    const result = allocateInvoices(
      [invoice("a", "2026-09-01", 2_000)],
      -500,
      "2026-09-02",
    );
    expect(result[0]).toMatchObject({ state: "paid", remainingAgorot: 0 });
  });

  it("summarises purchases, payments and the oldest unpaid amount", () => {
    const summary = summarizeCustomer({
      invoices: [
        invoice("a", "2026-09-01", 2_000),
        invoice("b", "2026-09-10", 3_000),
      ],
      entries: [
        { type: "invoice", amountAgorot: 2_000 },
        { type: "invoice", amountAgorot: 3_000 },
        { type: "payment", amountAgorot: -2_500 },
        { type: "payment", amountAgorot: -1_000 },
        { type: "payment_reversal", amountAgorot: 1_000 },
      ],
      today: "2026-09-20",
    });
    expect(summary).toEqual({
      balanceAgorot: 2_500,
      totalPurchasesAgorot: 5_000,
      totalPaidAgorot: 2_500,
      oldestUnpaid: { amountAgorot: 2_500, date: "2026-09-10", ageDays: 10 },
    });
  });
});

describe("sale calculation", () => {
  const lines = [
    { quantityMilli: 2_000, unitPriceAgorot: 1_200 },
    { quantityMilli: 1_000, unitPriceAgorot: 800 },
  ];

  it("computes totals and the remaining balance", () => {
    expect(
      calculateSale({
        lines,
        discountAgorot: 200,
        paidAgorot: 2_000,
        hasCustomer: true,
      }),
    ).toEqual({
      lineTotalsAgorot: [2_400, 800],
      subtotalAgorot: 3_200,
      discountAgorot: 200,
      totalAgorot: 3_000,
      paidAgorot: 2_000,
      remainingAgorot: 1_000,
    });
  });

  it("refuses credit without a named customer and overpayment", () => {
    const code = (run: () => unknown) => {
      try {
        run();
        return "ok";
      } catch (error) {
        return (error as SaleCalculationError).code;
      }
    };
    expect(
      code(() =>
        calculateSale({
          lines,
          discountAgorot: 0,
          paidAgorot: 1_000,
          hasCustomer: false,
        }),
      ),
    ).toBe("cash_sale_must_be_paid");
    expect(
      code(() =>
        calculateSale({
          lines,
          discountAgorot: 0,
          paidAgorot: 9_999,
          hasCustomer: true,
        }),
      ),
    ).toBe("paid_exceeds_total");
    expect(
      code(() =>
        calculateSale({
          lines,
          discountAgorot: 5_000,
          paidAgorot: 0,
          hasCustomer: true,
        }),
      ),
    ).toBe("discount_exceeds_subtotal");
  });

  it("derives gross profit from recorded line costs", () => {
    expect(
      saleProfit({
        lines: [
          { lineTotalAgorot: 2_400, cogsAgorot: 1_600 },
          { lineTotalAgorot: 800, cogsAgorot: 500 },
        ],
        subtotalAgorot: 3_200,
        discountAgorot: 200,
      }),
    ).toEqual({
      complete: true,
      revenueAgorot: 3_000,
      cogsAgorot: 2_100,
      grossProfitAgorot: 900,
      marginBasisPoints: 3_000,
    });
  });

  it("excludes lines without a recorded cost and says so", () => {
    const profit = saleProfit({
      lines: [
        { lineTotalAgorot: 2_400, cogsAgorot: 1_600 },
        { lineTotalAgorot: 800, cogsAgorot: null },
      ],
      subtotalAgorot: 3_200,
      discountAgorot: 0,
    });
    expect(profit).toMatchObject({
      complete: false,
      revenueAgorot: 2_400,
      cogsAgorot: 1_600,
      grossProfitAgorot: 800,
    });
  });
});

describe("sale draft", () => {
  it("builds an integer payload from typed text", () => {
    const draft = emptySaleDraft();
    draft.customerMode = "new";
    draft.newCustomerName = " أحمد ";
    draft.lines = [
      { key: "l1", variantId: "arar--default", quantity: "٢", unitPrice: "12" },
    ];
    draft.payment = "partial";
    draft.paid = "10.50";
    const { payload, errors } = buildSalePayload(draft, {
      idempotencyKey: "00000000-0000-4000-8000-000000000000",
      source: "manual",
    });
    expect(errors).toEqual({});
    expect(payload).toMatchObject({
      customerName: "أحمد",
      lines: [
        {
          variantId: "arar--default",
          quantityMilli: 2_000,
          unitPriceAgorot: 1_200,
        },
      ],
      paidAgorot: 1_050,
    });
  });

  it("blocks credit for an anonymous cash sale and duplicate products", () => {
    const draft = emptySaleDraft();
    draft.lines = [
      { key: "l1", variantId: "a", quantity: "1", unitPrice: "5" },
      { key: "l2", variantId: "a", quantity: "1", unitPrice: "5" },
    ];
    expect(
      buildSalePayload(draft, { idempotencyKey: "k", source: "manual" }).errors[
        "l2.variantId"
      ],
    ).toContain("مكرر");

    draft.lines = [draft.lines[0]!];
    draft.payment = "unpaid";
    expect(
      buildSalePayload(draft, { idempotencyKey: "k", source: "manual" }).errors
        .customer,
    ).toBe("البيع بالدَّين يحتاج اسم الزبون.");
  });
});

describe("invoice sharing", () => {
  it("prepares a WhatsApp link that still needs the person to press send", () => {
    const text = buildInvoiceShareText({
      invoiceNumber: 1001,
      customerName: "أحمد",
      date: "2026-09-30",
      lines: [
        { name: "سائل جلي", quantityMilli: 2_000, lineTotalAgorot: 2_400 },
      ],
      discountAgorot: 0,
      totalAgorot: 2_400,
      paidAtSaleAgorot: 1_000,
    });
    expect(text).toContain("فاتورة رقم 1001");
    expect(text).toContain("الباقي: 14 ₪");
    const url = buildWhatsAppShareUrl(text, "+970591234567");
    expect(url.startsWith("https://wa.me/970591234567?text=")).toBe(true);
    expect(buildWhatsAppShareUrl(text, null)).toMatch(
      /^https:\/\/wa\.me\/\?text=/,
    );
  });
});
