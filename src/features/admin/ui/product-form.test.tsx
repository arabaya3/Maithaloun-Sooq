import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/features/admin/application/admin-actions", () => ({
  createProductAction: vi.fn(async () => null),
  updateProductAction: vi.fn(async () => null),
  upsertProductVariantAction: vi.fn(async () => null),
  deactivateProductVariantAction: vi.fn(async () => null),
  upsertProductSpecificationAction: vi.fn(async () => null),
  removeProductSpecificationAction: vi.fn(async () => null),
}));

import { ProductForm } from "./product-form";

describe("ProductForm progressive disclosure", () => {
  it("defaults to quick add without wizard steps", () => {
    render(<ProductForm sortOrder={10} mode="create" />);
    expect(screen.getByText("هذا المنتج له أكثر من حجم أو وزن")).toBeVisible();
    expect(screen.getByRole("button", { name: "إنشاء المنتج" })).toBeVisible();
    expect(
      screen.queryByRole("list", { name: "خطوات إنشاء المنتج" }),
    ).toBeNull();
    expect(screen.getByLabelText("الاسم العربي")).toBeVisible();
    expect(screen.getByLabelText("السعر بالشيكل")).toBeVisible();
  });

  it("reveals the multi-step wizard when multi-size is enabled", async () => {
    const user = userEvent.setup();
    render(<ProductForm sortOrder={10} mode="create" />);
    await user.click(
      screen.getByRole("checkbox", { name: /أكثر من حجم أو وزن/ }),
    );
    expect(
      screen.getByRole("list", { name: "خطوات إنشاء المنتج" }),
    ).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "المعلومات الأساسية" }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "التالي" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "إنشاء المنتج" })).toBeNull();
  });
});
