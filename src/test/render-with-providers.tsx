import { render, type RenderOptions } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";

import { CartProvider } from "@/features/cart/cart-provider";
import type { Product } from "@/features/catalog/domain/product";
import { DeliveryProvider } from "@/features/delivery/delivery-provider";
import { FavoritesProvider } from "@/features/favorites/favorites-provider";

function catalogFromProducts(products: readonly Product[]) {
  return products.map((product) => ({
    productId: product.id,
    defaultVariantId: product.defaultVariantId,
    variantIds: product.variants.map((variant) => variant.id),
  }));
}

export function renderWithProviders(
  ui: ReactElement,
  {
    productIds,
    products,
    ...options
  }: RenderOptions & {
    productIds?: readonly string[];
    products?: readonly Product[];
  },
) {
  const locations = [{ code: "maythalun", nameAr: "ميثلون" }];
  const catalog =
    products != null
      ? catalogFromProducts(products)
      : (productIds ?? []).map((productId) => ({
          productId,
          defaultVariantId: `${productId}--default`,
          variantIds: [`${productId}--default`],
        }));
  const favoriteIds =
    products?.map((product) => product.id) ?? productIds ?? [];

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <DeliveryProvider locations={locations}>
        <FavoritesProvider productIds={favoriteIds}>
          <CartProvider catalog={catalog}>{children}</CartProvider>
        </FavoritesProvider>
      </DeliveryProvider>
    );
  }

  return render(ui, { wrapper: Wrapper, ...options });
}
