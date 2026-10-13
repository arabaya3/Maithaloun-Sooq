import { render, type RenderOptions } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";

import { CartProvider } from "@/features/cart/cart-provider";
import type { Product } from "@/features/catalog/domain/product";
import { DeliveryProvider } from "@/features/delivery/delivery-provider";
import { FavoritesProvider } from "@/features/favorites/favorites-provider";
import type { Locale } from "@/i18n/config";
import { I18nProvider } from "@/i18n/i18n-provider";
import { singleSellingUnit } from "@/test/mock-product-repository";

export function catalogFromProducts(products: readonly Product[]) {
  return products.map((product) => ({
    productId: product.id,
    defaultVariantId: product.defaultVariantId,
    variants: product.variants.map((variant) => ({
      id: variant.id,
      sellingUnits: variant.sellingUnits.map((unit) => ({
        id: unit.id,
        unitsPerSale: unit.unitsPerSale,
      })),
    })),
  }));
}

export function renderWithProviders(
  ui: ReactElement,
  {
    productIds,
    products,
    locale = "ar",
    ...options
  }: RenderOptions & {
    productIds?: readonly string[];
    products?: readonly Product[];
    locale?: Locale;
  },
) {
  const locations = [{ code: "maythalun", nameAr: "ميثلون" }];
  const catalog =
    products != null
      ? catalogFromProducts(products)
      : (productIds ?? []).map((productId) => {
          const variantId = `${productId}--default`;
          const unit = singleSellingUnit(variantId, 100);
          return {
            productId,
            defaultVariantId: variantId,
            variants: [
              {
                id: variantId,
                sellingUnits: [{ id: unit.id, unitsPerSale: 1 }],
              },
            ],
          };
        });
  const favoriteIds =
    products?.map((product) => product.id) ?? productIds ?? [];

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <I18nProvider locale={locale}>
        <DeliveryProvider locations={locations}>
          <FavoritesProvider productIds={favoriteIds}>
            <CartProvider catalog={catalog}>{children}</CartProvider>
          </FavoritesProvider>
        </DeliveryProvider>
      </I18nProvider>
    );
  }

  return render(ui, { wrapper: Wrapper, ...options });
}
