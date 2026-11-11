import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OrderStatusForm } from "./order-status-form";

const update = vi.fn().mockResolvedValue(null);
vi.mock("@/features/admin/application/admin-actions", () => ({
  updateOrderStatusAction: (...args: unknown[]) => update(...args),
}));

afterEach(() => {
  cleanup();
  update.mockClear();
});

describe("compact order actions", () => {
  it("submits the existing transition and version from the primary button", async () => {
    const user = userEvent.setup();
    render(
      <OrderStatusForm
        publicReference="MS-existing"
        version={7}
        status="preparing"
        totalAgorot={3000}
      />,
    );
    expect(screen.getByText(/30/)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "خرج للتوصيل" }));
    await waitFor(() => expect(update).toHaveBeenCalledOnce());
    const form = update.mock.calls[0][0] as FormData;
    expect(form.get("publicReference")).toBe("MS-existing");
    expect(form.get("expectedVersion")).toBe("7");
    expect(form.get("nextStatus")).toBe("out_for_delivery");
  });

  it("requires a second explicit action to cancel an order", async () => {
    const user = userEvent.setup();
    render(
      <OrderStatusForm
        publicReference="MS-existing"
        version={1}
        status="confirmed"
      />,
    );
    expect(screen.getByRole("button", { name: "بدء التجهيز" })).toBeVisible();
    await user.click(screen.getByText("إجراءات إضافية"));
    await user.click(screen.getByRole("button", { name: "إلغاء الطلب" }));
    expect(update).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "تأكيد الإلغاء" }));
    await waitFor(() => expect(update).toHaveBeenCalledOnce());
    expect((update.mock.calls[0][0] as FormData).get("nextStatus")).toBe(
      "cancelled",
    );
  });

  it("keeps stock blockers visible and prevents submitting the blocked action", () => {
    render(
      <OrderStatusForm
        publicReference="MS-existing"
        version={1}
        status="pending"
        impacts={{
          confirmed: {
            blocked: true,
            stock: ["الكمية غير كافية"],
            money: "لم يتغير المبلغ",
          },
        }}
      />,
    );
    expect(screen.getByText("الكمية غير كافية")).toBeVisible();
    expect(screen.getByRole("button", { name: "تأكيد الطلب" })).toBeDisabled();
  });

  it("only offers cancellation for internal test orders", () => {
    render(
      <OrderStatusForm
        publicReference="MS-test"
        version={1}
        status="pending"
        cancelOnly
      />,
    );
    expect(
      screen.queryByRole("button", { name: "تأكيد الطلب" }),
    ).not.toBeInTheDocument();
  });
});
