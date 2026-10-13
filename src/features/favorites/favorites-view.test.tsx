import { act, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { I18nProvider } from "@/i18n/i18n-provider";
import { renderWithProviders } from "@/test/render-with-providers";

import { FavoritesView } from "./favorites-view";

beforeEach(() => {
  window.localStorage.clear();
});

describe("FavoritesView", () => {
  it("shows the Arabic empty state by default", async () => {
    renderWithProviders(
      <FavoritesView products={[]} accountsEnabled={false} retiredNames={[]} />,
      { productIds: [] },
    );
    await act(async () => {});
    expect(
      screen.getByRole("heading", { name: "لا توجد منتجات في المفضلة" }),
    ).toBeInTheDocument();
  });

  it("shows the English empty state with localized links", async () => {
    renderWithProviders(
      <I18nProvider locale="en">
        <FavoritesView products={[]} accountsEnabled retiredNames={[]} />
      </I18nProvider>,
      { productIds: [] },
    );
    await act(async () => {});
    expect(
      screen.getByRole("heading", { level: 1, name: "Wishlist" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Your wishlist is empty" }),
    ).toBeInTheDocument();
    expect(screen.getByText("No products")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Browse products" }),
    ).toHaveAttribute("href", "/en");
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      "/en/account?next=/favorites",
    );
  });
});
