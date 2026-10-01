import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "@/test/render-with-providers";

import { MobileNavigation } from "./mobile-navigation";
import { SiteHeader } from "./site-header";

vi.mock("next/navigation", () => ({
  usePathname: () => "/offers",
}));

describe("SiteHeader", () => {
  it("shows the brand spelled correctly and hides the badge for an empty cart", () => {
    const { container } = renderWithProviders(<SiteHeader />, {
      productIds: [],
    });

    expect(
      screen.getByRole("link", { name: "سوق ميثلون، الرئيسية" }),
    ).toBeInTheDocument();
    expect(container).not.toHaveTextContent("ميتلون");
    const brand = container.querySelector(".brand")!;
    expect(brand.querySelector(".brand-word")!.textContent).toMatch(
      /^سوق ميثلون، الرئيسية$/,
    );
    const visibleWord = [
      ...brand.querySelectorAll(".brand-word > span:not(.sr-only)"),
    ]
      .map((part) => part.textContent)
      .join(" ");
    expect(visibleWord).toBe("سوق ميثلون");
    expect(brand.querySelector(".brand-tagline")).toHaveTextContent(
      "منظفات ومعطرات جو",
    );
    expect(brand.querySelector("img")).toHaveAttribute("alt", "");
    expect(container.textContent).not.toContain("سوق ميثون");
    expect(
      screen.getByRole("link", { name: /^السلة، عدد المنتجات\s*0$/ }),
    ).toHaveAttribute("href", "/cart");
    expect(container.querySelector(".cart-count")).toBeNull();
    expect(screen.getByText(/توصيل داخل ميثلون/)).toBeInTheDocument();
  });

  it("focuses the product search from the header search button", async () => {
    const user = userEvent.setup();
    const ref = createRef<HTMLInputElement>();
    Element.prototype.scrollIntoView = vi.fn();
    renderWithProviders(
      <>
        <SiteHeader searchInputRef={ref} />
        <label htmlFor="search">ابحث في المنتجات</label>
        <input id="search" type="search" ref={ref} />
      </>,
      { productIds: [] },
    );

    await user.click(screen.getByRole("button", { name: "البحث عن منتج" }));
    expect(
      screen.getByRole("searchbox", { name: "ابحث في المنتجات" }),
    ).toHaveFocus();
  });
});

describe("MobileNavigation", () => {
  it("offers four real destinations and marks the current one without relying on colour", () => {
    renderWithProviders(<MobileNavigation />, { productIds: [] });

    const links = screen.getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/",
      "/categories",
      "/offers",
      "/account",
    ]);
    expect(screen.getByRole("link", { name: "العروض" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "الرئيسية" })).not.toHaveAttribute(
      "aria-current",
    );
  });
});
