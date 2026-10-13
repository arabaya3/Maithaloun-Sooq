import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

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
const request = vi.hoisted(() => ({ locale: "ar" as "ar" | "en" }));
vi.mock("@/i18n/server", async () => {
  const { messagesFor } = await import("@/i18n/messages");
  return {
    getLocale: async () => request.locale,
    getMessages: async () => messagesFor(request.locale),
  };
});
vi.mock("@/features/catalog/infrastructure/product-repository", async () => {
  const { MockProductRepository } =
    await import("@/test/mock-product-repository");
  return { productRepository: new MockProductRepository() };
});

vi.mock("@/features/catalog/infrastructure/category-repository", async () => {
  const { seedCategories } = await import("@/features/catalog/domain/product");
  return {
    assignableCategories: async () =>
      seedCategories.map(({ code, nameAr }) => ({ code, nameAr })),
  };
});

import ProductPage from "./page";

describe("product details page", () => {
  afterEach(() => {
    request.locale = "ar";
  });

  it("renders the English page with English chrome and the original product name", async () => {
    request.locale = "en";
    const products = await new MockProductRepository().list();
    const user = userEvent.setup();
    const page = await ProductPage({
      params: Promise.resolve({ slug: "general-cleaner-secret" }),
      searchParams: Promise.resolve({}),
    });

    renderWithProviders(page, { products, locale: "en" });

    expect(
      screen.getByRole("heading", { level: 1, name: "منظف عام Secret" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Price 7 ₪")).toBeInTheDocument();
    expect(screen.getByText("Available to add to cart")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Back to products" }),
    ).toHaveAttribute("href", "/en");

    const actions = document.querySelector<HTMLElement>(
      ".product-detail-actions",
    );
    await user.click(
      within(actions!).getByRole("button", { name: "Add to cart" }),
    );
    expect(
      screen.getByText("منظف عام Secret added to your cart."),
    ).toBeInTheDocument();
  });

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
    expect(screen.getByText(/توصيل داخل ميثلون/)).toBeInTheDocument();

    const actions = document.querySelector<HTMLElement>(
      ".product-detail-actions",
    );
    expect(actions).not.toBeNull();
    await user.click(
      within(actions!).getByRole("button", { name: "أضف إلى السلة" }),
    );
    expect(
      screen.getByRole("link", { name: /^السلة، عدد المنتجات\s*1$/ }),
    ).toBeVisible();
    expect(
      screen.getByText("تمت إضافة منظف عام Secret إلى السلة."),
    ).toBeInTheDocument();
  });
});
