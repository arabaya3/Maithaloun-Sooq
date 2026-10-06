import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CART_STORAGE_KEY } from "@/features/cart/cart-store";
import { ProductDetailPanel } from "@/features/catalog/components/product-detail-panel";
import { productSchema, type Product } from "@/features/catalog/domain/product";
import type { GalleryImage } from "@/features/catalog/domain/product-gallery";
import type { ProductPresentation } from "@/features/catalog/domain/product-presentation";
import { singleSellingUnit } from "@/test/mock-product-repository";
import { renderWithProviders } from "@/test/render-with-providers";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));

const PRICES: Record<string, number> = {
  "loyal--blue-small": 1000,
  "loyal--blue-large": 1800,
  "loyal--pink-small": 1100,
  "loyal--pink-large": 1900,
};
const label: Record<string, string> = {
  "loyal--blue-small": "أزرق · صغير",
  "loyal--blue-large": "أزرق · كبير",
  "loyal--pink-small": "زهري · صغير",
  "loyal--pink-large": "زهري · كبير",
};

function loyal(archived: string[] = []): Product {
  const ids = Object.keys(PRICES).filter((id) => !archived.includes(id));
  return productSchema.parse({
    id: "loyal",
    slug: "loyal",
    nameAr: "معطر لويال",
    priceAgorot: 1100,
    categoryId: "home",
    image: { kind: "placeholder", variant: "general-cleaner" },
    availability: "available",
    detailsStatus: "placeholder",
    publication: "published",
    defaultVariantId: "loyal--pink-small",
    specifications: [],
    variants: ids.map((id, sortOrder) => ({
      id,
      productId: "loyal",
      labelAr: label[id],
      attributes: {},
      priceAgorot: PRICES[id],
      availability: "available",
      image: { kind: "placeholder", variant: "general-cleaner" },
      sortOrder,
      isDefault: id === "loyal--pink-small",
      sellingUnits: [singleSellingUnit(id, PRICES[id]!)],
    })),
  });
}

const image = (
  id: string,
  scope: GalleryImage["scope"],
  extra: Partial<GalleryImage> = {},
): GalleryImage => ({
  id,
  src: `/products/${id}.webp`,
  alt: "معطر لويال",
  width: 800,
  height: 800,
  sortOrder: 0,
  isPrimary: false,
  scope,
  variantId: null,
  optionId: null,
  optionValueId: null,
  ...extra,
});

function presentation(archived: string[] = []): ProductPresentation {
  const pairs: Record<string, [string, string]> = {
    "loyal--blue-small": ["blue", "small"],
    "loyal--blue-large": ["blue", "large"],
    "loyal--pink-small": ["pink", "small"],
    "loyal--pink-large": ["pink", "large"],
  };
  return {
    options: [
      {
        id: "color",
        nameAr: "اللون",
        kind: "color",
        sortOrder: 0,
        values: [
          { id: "blue", valueAr: "أزرق", sortOrder: 0 },
          { id: "pink", valueAr: "زهري", sortOrder: 1 },
        ],
      },
      {
        id: "size",
        nameAr: "الحجم",
        kind: "size",
        sortOrder: 1,
        values: [
          { id: "small", valueAr: "صغير", sortOrder: 0 },
          { id: "large", valueAr: "كبير", sortOrder: 1 },
        ],
      },
    ],
    variantOptions: Object.fromEntries(
      Object.entries(pairs)
        .filter(([id]) => !archived.includes(id))
        .map(([id, [color, size]]) => [id, { color, size }]),
    ),
    packCounts: {},
    incomplete: false,
    gallery: [
      image("shared", "product", { isPrimary: true }),
      image("blue", "option_value", {
        optionId: "color",
        optionValueId: "blue",
        sortOrder: 1,
      }),
      image("pink", "option_value", {
        optionId: "color",
        optionValueId: "pink",
        sortOrder: 2,
      }),
      image("pink-large", "variant", {
        variantId: "loyal--pink-large",
        sortOrder: 3,
      }),
    ],
  };
}

function render(archived: string[] = []) {
  const product = loyal(archived);
  return renderWithProviders(
    <ProductDetailPanel
      product={product}
      categoryLabel="المنزل"
      presentation={presentation(archived)}
    />,
    { products: [product] },
  );
}

const mainImage = () =>
  document.querySelector<HTMLImageElement>(".product-gallery-image");
const radio = (group: string, name: string) =>
  within(screen.getByRole("radiogroup", { name: group })).getByRole("radio", {
    name: new RegExp(`^${name}`),
  });

beforeEach(() => {
  window.localStorage.clear();
  window.history.replaceState(null, "", "/products/loyal");
});

describe("product page selection", () => {
  it("starts on the default variant with its colour image", () => {
    render();
    expect(radio("اللون", "زهري")).toBeChecked();
    expect(radio("الحجم", "صغير")).toBeChecked();
    expect(mainImage()?.getAttribute("src")).toContain("pink.webp");
  });

  it("tapping the blue image selects only blue and keeps the compatible size", async () => {
    const user = userEvent.setup();
    render();
    await user.click(screen.getByRole("radio", { name: /^كبير/ }));
    await user.click(
      screen.getByRole("button", { name: /عرض الصورة 2 من 4 — اللون: أزرق/ }),
    );
    expect(radio("اللون", "أزرق")).toBeChecked();
    expect(radio("اللون", "زهري")).not.toBeChecked();
    expect(radio("الحجم", "كبير")).toBeChecked();
    expect(screen.getByLabelText("السعر 18 ₪")).toBeInTheDocument();
    expect(window.location.search).toBe("?variant=loyal--blue-large");
    expect(mainImage()?.getAttribute("src")).toContain("blue.webp");
  });

  it("choosing pink large through the options shows the exact-variant image", async () => {
    const user = userEvent.setup();
    render();
    await user.click(radio("الحجم", "كبير"));
    expect(mainImage()?.getAttribute("src")).toContain("pink-large.webp");
    await user.click(radio("الحجم", "صغير"));
    expect(mainImage()?.getAttribute("src")).toContain("pink.webp");
  });

  it("a shared image changes only the view", async () => {
    const user = userEvent.setup();
    render();
    await user.click(screen.getByRole("button", { name: "عرض الصورة 1 من 4" }));
    expect(mainImage()?.getAttribute("src")).toContain("shared.webp");
    expect(radio("اللون", "زهري")).toBeChecked();
    expect(screen.getByLabelText("السعر 11 ₪")).toBeInTheDocument();
  });

  it("an archived variant can never be reached; its size moves the colour instead", async () => {
    const user = userEvent.setup();
    render(["loyal--blue-large"]);
    await user.click(radio("اللون", "أزرق"));
    expect(radio("الحجم", "كبير")).toHaveAttribute("data-state", "adjusts");
    await user.click(radio("الحجم", "كبير"));
    expect(radio("اللون", "زهري")).toBeChecked();
    expect(radio("الحجم", "كبير")).toBeChecked();
    expect(screen.getByLabelText("السعر 19 ₪")).toBeInTheDocument();
  });

  it("shows a published product with incomplete variants as unavailable", () => {
    const product = loyal();
    renderWithProviders(
      <ProductDetailPanel
        product={product}
        categoryLabel="المنزل"
        presentation={{ ...presentation(), incomplete: true }}
      />,
      { products: [product] },
    );
    expect(
      screen.getByText("غير متاح حالياً، نجهّز خيارات هذا المنتج"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "المنتج غير متاح" }),
    ).toBeDisabled();
    expect(window.localStorage.getItem(CART_STORAGE_KEY)).toBeNull();
  });

  it("adds exactly the variant on screen to the cart", async () => {
    const user = userEvent.setup();
    render();
    await user.click(
      screen.getByRole("button", { name: /عرض الصورة 2 من 4 — اللون: أزرق/ }),
    );
    await user.click(screen.getByRole("button", { name: "أضف إلى السلة" }));
    const saved = JSON.parse(
      window.localStorage.getItem(CART_STORAGE_KEY) ?? "{}",
    ) as { lines?: Array<{ variantId: string }> };
    expect(saved.lines?.map((line) => line.variantId)).toEqual([
      "loyal--blue-small",
    ]);
  });

  it("keyboard arrows move between thumbnails in RTL order", async () => {
    const user = userEvent.setup();
    render();
    const active = screen.getByRole("button", { current: true });
    active.focus();
    await user.keyboard("{ArrowLeft}");
    expect(document.activeElement).toHaveAttribute("aria-current", "true");
    expect(document.activeElement?.getAttribute("aria-label")).toMatch(
      /^عرض الصورة 4 من 4/,
    );
  });

  it("a failed image becomes a same-size placeholder without retrying", () => {
    render();
    fireEvent.error(mainImage()!);
    expect(mainImage()).toBeNull();
    expect(
      document.querySelector(".product-gallery-stage .product-gallery-missing"),
    ).not.toBeNull();
  });
});
