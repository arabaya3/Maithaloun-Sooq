import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { MockProductRepository } from "@/test/mock-product-repository";
import { renderWithProviders } from "@/test/render-with-providers";

vi.mock("next/server", () => ({
  connection: async () => undefined,
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/products/general-cleaner-secret",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("@/features/catalog/infrastructure/product-repository", async () => {
  const { MockProductRepository } =
    await import("@/test/mock-product-repository");
  return { productRepository: new MockProductRepository() };
});

import ProductPage from "./page";

describe("product details page", () => {
  it("renders repository product details with bidi-safe price and adds to cart", async () => {
    const products = await new MockProductRepository().list();
    const user = userEvent.setup();
    const page = await ProductPage({
      params: Promise.resolve({ slug: "general-cleaner-secret" }),
      searchParams: Promise.resolve({}),
    });

    renderWithProviders(page, { products });

    expect(
      screen.getByRole("heading", { level: 1, name: "منظف عام Secret" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("السعر 7 ₪")).toHaveTextContent("7 ₪");
    expect(screen.getByText("متاح للإضافة إلى السلة")).toBeInTheDocument();
    expect(screen.getByLabelText("منطقة التوصيل")).toHaveTextContent(
      "التوصيل داخل ميثلون",
    );

    await user.click(screen.getByRole("button", { name: "أضف إلى السلة" }));
    expect(
      screen.getAllByRole("link", { name: "السلة، منتج واحد" }),
    ).toHaveLength(2);
    expect(
      screen.getByText("تمت إضافة منظف عام Secret إلى السلة."),
    ).toBeInTheDocument();
  });
});
