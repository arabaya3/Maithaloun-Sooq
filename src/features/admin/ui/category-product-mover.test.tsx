import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const moveAction = vi.fn();
const refresh = vi.fn();

vi.mock("@/features/admin/application/catalog-management-actions", () => ({
  moveProductsAction: (...args: unknown[]) => moveAction(...args),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { CategoryProductMover } from "./category-product-mover";

const props = {
  categoryName: "المنزل",
  products: [
    { id: "soap", name: "صابون", status: "منشور" },
    { id: "spray", name: "بخاخ", status: "مسودة" },
  ],
  targets: [{ code: "kitchen", nameAr: "المطبخ" }],
};

beforeEach(() => {
  moveAction.mockReset();
  refresh.mockReset();
});

describe("moving products between categories", () => {
  it("moves only the chosen products, and only after an explicit confirmation", async () => {
    const user = userEvent.setup();
    moveAction.mockResolvedValue({ ok: true, moved: 1 });
    render(<CategoryProductMover {...props} />);
    const move = screen.getByRole("button", { name: "نقل المنتجات المحددة" });
    expect(move).toBeDisabled();

    await user.click(screen.getByRole("checkbox", { name: /بخاخ/ }));
    await user.selectOptions(screen.getByLabelText("القسم الجديد"), "kitchen");
    await user.click(move);
    expect(moveAction).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "نقل 1 منتج من «المنزل» إلى «المطبخ»؟",
    );

    await user.click(screen.getByRole("button", { name: "تأكيد النقل" }));
    expect(moveAction).toHaveBeenCalledWith({
      productDomainIds: ["spray"],
      targetCode: "kitchen",
    });
    expect(await screen.findByRole("status")).toHaveTextContent(
      "نُقل 1 منتج إلى «المطبخ».",
    );
    expect(refresh).toHaveBeenCalled();
  });

  it("shows the server's refusal and keeps the selection", async () => {
    const user = userEvent.setup();
    moveAction.mockResolvedValue({ ok: false, message: "القسم غير متاح." });
    render(<CategoryProductMover {...props} />);
    await user.click(screen.getByRole("checkbox", { name: "تحديد الكل" }));
    await user.selectOptions(screen.getByLabelText("القسم الجديد"), "kitchen");
    await user.click(
      screen.getByRole("button", { name: "نقل المنتجات المحددة" }),
    );
    await user.click(screen.getByRole("button", { name: "تأكيد النقل" }));
    expect(moveAction.mock.calls[0]![0].productDomainIds).toEqual([
      "soap",
      "spray",
    ]);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "القسم غير متاح.",
    );
    expect(screen.getByRole("checkbox", { name: /صابون/ })).toBeChecked();
  });
});
