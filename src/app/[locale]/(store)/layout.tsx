import type { ReactNode } from "react";
import { preload } from "react-dom";

import {
  loadAccountFavoritesAction,
  mergeFavoritesAction,
  setFavoriteAction,
} from "@/features/accounts/application/account-actions";
import { customerAccountsEnabled } from "@/features/accounts/domain/account-config";
import { CartProvider } from "@/features/cart/cart-provider";
import { localizedCategoryName } from "@/features/catalog/domain/category";
import { storefrontCategories } from "@/features/catalog/infrastructure/category-repository";
import { productRepository } from "@/features/catalog/infrastructure/product-repository";
import { DeliveryProvider } from "@/features/delivery/delivery-provider";
import { serviceAreaRepository } from "@/features/delivery/service-area-repository";
import { FavoritesProvider } from "@/features/favorites/favorites-provider";
import { DomainMoveNotice } from "@/features/pwa/domain-move-notice";
import { StorefrontInstallBanner } from "@/features/pwa/storefront-install-banner";
import { storeContactService } from "@/features/orders/application/order-service-instance";
import { StoreFooter } from "@/features/storefront/components/store-footer";
import { StoreLaunchSplash } from "@/features/storefront/components/store-launch-splash";
import { StoreNavigationProvider } from "@/features/storefront/components/store-navigation";
import { getLocale } from "@/i18n/server";

import "./storefront.css";

// Storefront pages are static: rendered once, served from the cache, refreshed by revalidateStorefront()
// whenever the owner changes the catalog, and at most every 15 minutes as a safety net (stock moves).
export const revalidate = 900;

// Catalog-backed providers live here so admin and utility routes never load the catalog. Nothing here
// reads the request, so every page under it can be served from the static cache; the signed-in
// customer's favorites are fetched by the browser instead.
const accountActions = {
  load: loadAccountFavoritesAction,
  save: setFavoriteAction,
  merge: mergeFavoritesAction,
};

export default async function StoreLayout({
  children,
}: {
  children: ReactNode;
}) {
  preload("/assets/fonts/readex-pro-v1.woff2", {
    as: "font",
    type: "font/woff2",
    crossOrigin: "anonymous",
  });
  const [products, serviceAreas, categories, locale, storeWhatsApp] =
    await Promise.all([
      productRepository.list(),
      serviceAreaRepository.listEnabled(),
      storefrontCategories(),
      getLocale(),
      storeContactService.whatsAppNumber(),
    ]);
  const productIds = products.map((product) => product.id);
  const catalog = products.map((product) => ({
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
  const locations = serviceAreas.map((area) => ({
    code: area.code,
    nameAr: area.nameAr,
  }));

  return (
    <DeliveryProvider locations={locations}>
      <StoreLaunchSplash />
      <FavoritesProvider
        productIds={productIds}
        accountActions={customerAccountsEnabled() ? accountActions : null}
      >
        <StoreNavigationProvider
          categories={categories.map((category) => ({
            code: category.code,
            name: localizedCategoryName(category, locale),
          }))}
        >
          <CartProvider catalog={catalog}>{children}</CartProvider>
        </StoreNavigationProvider>
        <StoreFooter storeWhatsApp={storeWhatsApp} />
        <StorefrontInstallBanner />
        <DomainMoveNotice />
      </FavoritesProvider>
    </DeliveryProvider>
  );
}
