import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  agingBucket,
  buildStatement,
} from "@/features/sales/domain/customer-balance";

import { CustomerPaymentForm } from "./customer-payment-form";

vi.mock("@/features/sales/application/sales-actions", () => ({
  recordCustomerPaymentAction: vi.fn(async () => null),
  cancelInvoiceAction: vi.fn(),
  reversePaymentAction: vi.fn(),
  saveCustomerAction: vi.fn(),
}));

describe("customer payment preview", () => {
  it("shows the current balance, this payment and what remains before saving", async () => {
    const user = userEvent.setup();
    render(<CustomerPaymentForm customerId="c1" balanceAgorot={5_000} />);
    expect(screen.getByText("الرصيد الحالي")).toBeVisible();
    await user.type(screen.getByLabelText("المبلغ المستلم ₪"), "20");
    const list = screen.getByText("الرصيد بعد الدفعة").closest("dl")!;
    expect(list).toHaveTextContent("50 ₪");
    expect(list).toHaveTextContent("− 20 ₪");
    expect(list).toHaveTextContent("الرصيد بعد الدفعة30 ₪");
  });

  it("warns about an overpayment and an unreadable amount, leaving the final word to the server", async () => {
    const user = userEvent.setup();
    render(<CustomerPaymentForm customerId="c1" balanceAgorot={5_000} />);
    const amount = screen.getByLabelText("المبلغ المستلم ₪");
    await user.type(amount, "70");
    expect(
      screen.getByText("المبلغ أكبر من الرصيد المستحق بـ 20 ₪."),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "تسجيل دفعة" })).toBeEnabled();
    await user.clear(amount);
    await user.type(amount, "عشرين دولار");
    expect(screen.getByText(/اكتبي المبلغ بالشيكل/)).toBeVisible();
  });
});

describe("debt aging and statement", () => {
  it("puts the oldest unpaid invoice in one of three bands", () => {
    expect(agingBucket(0)).toBe("current");
    expect(agingBucket(30)).toBe("current");
    expect(agingBucket(31)).toBe("late");
    expect(agingBucket(60)).toBe("late");
    expect(agingBucket(61)).toBe("old");
  });

  it("runs the balance oldest first, so the last line is the current balance", () => {
    const at = (day: number) => new Date(Date.UTC(2026, 9, day));
    const lines = buildStatement([
      {
        id: "p",
        type: "payment",
        amountAgorot: -2_000,
        createdAt: at(3),
        invoiceId: null,
      },
      {
        id: "i",
        type: "invoice",
        amountAgorot: 5_000,
        createdAt: at(1),
        invoiceId: "inv",
      },
      {
        id: "c",
        type: "invoice_cancellation",
        amountAgorot: -1_000,
        createdAt: at(5),
        invoiceId: "inv",
      },
    ]);
    expect(lines.map((line) => [line.id, line.balanceAgorot])).toEqual([
      ["i", 5_000],
      ["p", 3_000],
      ["c", 2_000],
    ]);
  });
});
