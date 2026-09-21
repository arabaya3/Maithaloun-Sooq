import { render, type RenderOptions } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";

import { CartProvider } from "@/features/cart/cart-provider";
import { DeliveryProvider } from "@/features/delivery/delivery-provider";
import { FavoritesProvider } from "@/features/favorites/favorites-provider";

export function renderWithProviders(
  ui: ReactElement,
  { productIds, ...options }: RenderOptions & { productIds: readonly string[] },
) {
  const locations = [
    { code: "ramallah", nameAr: "رام الله" },
    { code: "al-bireh", nameAr: "البيرة" },
    { code: "maythalun", nameAr: "ميثلون" },
    { code: "other", nameAr: "منطقة أخرى" },
  ];

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <DeliveryProvider locations={locations}>
        <FavoritesProvider productIds={productIds}>
          <CartProvider productIds={productIds}>{children}</CartProvider>
        </FavoritesProvider>
      </DeliveryProvider>
    );
  }

  return render(ui, { wrapper: Wrapper, ...options });
}
