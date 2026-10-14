import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import {
  seedCategories,
  type Product,
} from "@/features/catalog/domain/product";
import { withDefaultVariant } from "@/test/mock-product-repository";
import { renderWithProviders } from "@/test/render-with-providers";

import { Storefront } from "./storefront";

const item = (id: string, categoryId: string, priceAgorot: number) =>
  withDefaultVariant({
    id,
    slug: id,
    nameAr: `منظف ${id}`,
    priceAgorot,
    categoryId,
    image: { kind: "placeholder", variant: "general-cleaner" },
    availability: "available",
    detailsStatus: "placeholder",
  });

const products: Product[] = [
  item("a", "home", 900),
  item("b", "kitchen", 300),
  item("c", "home", 500),
];
const categories = seedCategories.map((category, sortOrder) => ({
  ...category,
  description: null,
  sortOrder,
  visible: true,
}));

function names() {
  return Array.from(document.querySelectorAll("#catalog article h3")).map(
    (node) => node.textContent,
  );
}

describe("catalog filters and sorting", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/?utm_source=flyer");
  });

  it("shows active filters as chips, and removing one keeps the search and other parameters", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <Storefront
        products={products}
        categories={categories}
        initialCategory="home"
        initialQuery="منظف"
      />,
      { products },
    );
    const chips = screen.getByRole("group", { name: "عوامل التصفية المختارة" });
    expect(within(chips).getAllByRole("button")).toHaveLength(3);
    // No bulky summary bar any more.
    expect(document.querySelector(".active-filter-summary")).toBeNull();

    await user.click(
      within(chips).getByRole("button", { name: /إزالة القسم/ }),
    );
    const url = new URL(window.location.href);
    expect(url.searchParams.get("category")).toBeNull();
    expect(url.searchParams.get("q")).toBe("منظف");
    expect(url.searchParams.get("utm_source")).toBe("flyer");
    expect(screen.getByRole("searchbox")).toHaveValue("منظف");
  });

  it("sorts by the shown price and remembers it in the address", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <Storefront products={products} categories={categories} />,
      { products },
    );
    expect(names()).toEqual(["منظف a", "منظف b", "منظف c"]);
    await user.selectOptions(
      screen.getByRole("combobox", { name: "ترتيب المنتجات" }),
      "price-asc",
    );
    expect(names()).toEqual(["منظف b", "منظف c", "منظف a"]);
    expect(new URL(window.location.href).searchParams.get("sort")).toBe(
      "price-asc",
    );
  });

  it("applies a category from the phone sheet only on «Show results»", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <Storefront products={products} categories={categories} />,
      { products },
    );
    await user.click(screen.getByRole("button", { name: /تصفية/ }));
    const sheet = screen.getByRole("dialog", { name: "تصفية المنتجات" });
    const kitchen = categories.find((category) => category.code === "kitchen")!;
    await user.click(
      within(sheet).getByRole("button", { name: kitchen.nameAr }),
    );
    expect(names()).toHaveLength(3);
    await user.click(
      within(sheet).getByRole("button", { name: "عرض النتائج" }),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(names()).toEqual(["منظف b"]);
  });
  it("sorts the whole matching catalog before the first batch, not only the visible cards", async () => {
    const user = userEvent.setup();
    // 15 products, the cheapest last, so it is outside the first batch of 12.
    const many = Array.from({ length: 15 }, (_, index) =>
      item(`p${index}`, "home", 2000 - index * 100),
    );
    renderWithProviders(
      <Storefront products={many} categories={categories} />,
      {
        products: many,
      },
    );
    expect(names()).toHaveLength(12);
    expect(names()).not.toContain("منظف p14");
    await user.selectOptions(
      screen.getByRole("combobox", { name: "ترتيب المنتجات" }),
      "price-asc",
    );
    expect(names()[0]).toBe("منظف p14");
    expect(names()).toHaveLength(12);
  });
});
