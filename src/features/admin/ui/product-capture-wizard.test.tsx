import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/features/admin/application/admin-actions", () => ({
  createCapturedProductAction: vi.fn(async () => null),
}));

import { ProductCaptureWizard } from "./product-capture-wizard";

describe("ProductCaptureWizard", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    URL.createObjectURL = vi.fn(() => "blob:preview");
    URL.revokeObjectURL = vi.fn();
  });

  it("starts with one clear photo task and a manual fallback", () => {
    render(<ProductCaptureWizard />);
    expect(screen.getByRole("heading", { name: "إضافة منتج" })).toBeVisible();
    expect(screen.getByRole("button", { name: /التقاط صورة/ })).toBeVisible();
    expect(
      screen.getByRole("link", { name: "إدخال المنتج يدوياً" }),
    ).toHaveAttribute("href", "/admin/products/new");
  });

  it("fills the review form from the analyzed photo while leaving price empty", async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          draft: {
            nameAr: "سائل جلي",
            latinName: "Arar",
            description: "سائل لتنظيف الصحون",
            unit: "عبوة",
            categoryId: "kitchen",
            brand: "Arar",
            sizeValue: "1",
            sizeUnit: "لتر",
            barcode: "123456",
            confidence: 0.9,
          },
          image: {
            src: "https://demo.supabase.co/storage/v1/object/public/product-images/item.webp",
            width: 1024,
            height: 1024,
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const { container } = render(<ProductCaptureWizard />);
    const input = container.querySelector('input[type="file"]');
    expect(input).not.toBeNull();
    await user.upload(
      input as HTMLInputElement,
      new File(["image"], "product.jpg", { type: "image/jpeg" }),
    );
    await user.click(
      screen.getByRole("button", { name: "قراءة بيانات المنتج" }),
    );

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: "راجعي بيانات المنتج" }),
      ).toBeVisible();
    });
    expect(screen.getByLabelText("اسم المنتج")).toHaveValue("سائل جلي");
    expect(screen.getByLabelText("السعر بالشيكل")).toHaveValue("");
    expect(screen.getByLabelText("الحجم")).toHaveValue("1 لتر");
  });
});
