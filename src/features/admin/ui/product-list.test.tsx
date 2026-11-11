import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProductList, type ProductListRow } from "./product-list";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/features/admin/application/simple-product-actions", () => ({
  quickEditProductAction: vi.fn(),
}));
vi.mock("@/features/admin/application/catalog-management-actions", () => ({
  bulkDeleteProductsAction: vi.fn(),
  bulkPublicationAction: vi.fn(),
  moveProductsAction: vi.fn(),
  restoreProductAction: vi.fn(),
}));
afterEach(cleanup);
describe("incremental product lists", () => {
  it("keeps selection limited to the products actually shown", async () => {
    const user = userEvent.setup();
    const rows: ProductListRow[] = Array.from({ length: 25 }, (_, i) => ({
      id: `product-${i}`,
      name: `منتج ${i + 1}`,
      category: "المطبخ",
      price: "5 ₪",
      variantCount: 1,
      publication: "published",
      available: true,
      flags: [],
    }));
    render(<ProductList rows={rows} canManage />);
    expect(screen.getByText("عرض 24 من 25 منتج")).toBeVisible();
    expect(
      screen.queryByRole("link", { name: /^منتج 25$/ }),
    ).not.toBeInTheDocument();
    await user.click(
      screen.getByRole("checkbox", { name: "تحديد كل المنتجات المعروضة" }),
    );
    expect(screen.getByText("24 منتجات محددة")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "عرض المزيد" }));
    await waitFor(() =>
      expect(screen.getByText("عرض 25 من 25 منتج")).toBeVisible(),
    );
    expect(
      screen.getByRole("checkbox", { name: "تحديد كل المنتجات المعروضة" }),
    ).not.toBeChecked();
    expect(screen.getByText("24 منتجات محددة")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "عرض المزيد" }),
    ).not.toBeInTheDocument();
  }, 15000);
});
