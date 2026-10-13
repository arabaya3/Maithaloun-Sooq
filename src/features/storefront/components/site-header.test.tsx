import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "@/test/render-with-providers";

import { MobileNavigation } from "./mobile-navigation";
import { SiteHeader } from "./site-header";
import { StoreNavigationProvider } from "./store-navigation";

vi.mock("next/navigation", () => ({
  usePathname: () => "/offers",
}));

describe("SiteHeader", () => {
  it("shows the MAYTHA wordmark, a plain search and hides the badge for an empty cart", () => {
    const { container } = renderWithProviders(
      <StoreNavigationProvider
        categories={[
          { code: "laundry", name: "الغسيل" },
          { code: "kitchen", name: "المطبخ" },
        ]}
      >
        <SiteHeader />
      </StoreNavigationProvider>,
      { productIds: [] },
    );

    expect(
      screen.getByRole("link", { name: "MAYTHA، الرئيسية" }),
    ).toHaveAttribute("href", "/");
    const brand = container.querySelector(".brand")!;
    expect(brand.querySelector(".brand-name")).toHaveTextContent(/^MAYTHA$/);
    expect(brand.querySelector(".brand-subtitle")).toHaveTextContent(
      /^HOME & CARE$/,
    );
    expect(container.textContent).not.toContain("سوق ميثلون");
    const search = screen.getByRole("searchbox", { name: "ابحث في المنتجات" });
    expect(search).toHaveAttribute("name", "q");
    expect(search.closest("form")).toHaveAttribute("action", "/");
    expect(
      screen.getByRole("link", { name: /^السلة، عدد المنتجات\s*0$/ }),
    ).toHaveAttribute("href", "/cart");
    expect(container.querySelector(".cart-count")).toBeNull();
    // The category row comes from the store data, and the current page is marked.
    expect(screen.getByRole("link", { name: "الغسيل" })).toHaveAttribute(
      "href",
      "/categories/laundry",
    );
    expect(
      screen
        .getByRole("navigation", { name: "التنقل الرئيسي" })
        .querySelector("[aria-current=page]"),
    ).toHaveTextContent("العروض");
  });

  it("uses the live search it is given instead of the plain one", () => {
    renderWithProviders(
      <SiteHeader
        search={
          <>
            <label htmlFor="live">ابحث مباشرة</label>
            <input id="live" type="search" />
          </>
        }
      />,
      { productIds: [] },
    );
    expect(
      screen.getByRole("searchbox", { name: "ابحث مباشرة" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("searchbox", { name: "ابحث في المنتجات" }),
    ).toBeNull();
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
