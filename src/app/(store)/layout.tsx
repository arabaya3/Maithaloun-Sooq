import { connection } from "next/server";
import type { ReactNode } from "react";
import { preload } from "react-dom";

import {
  mergeFavoritesAction,
  setFavoriteAction,
} from "@/features/accounts/application/account-actions";
import { customerFavoritesService } from "@/features/accounts/application/customer-services";
import { getCustomerSession } from "@/features/accounts/application/customer-session";
import { CartProvider } from "@/features/cart/cart-provider";
import { localizedCategoryName } from "@/features/catalog/domain/category";
import { storefrontCategories } from "@/features/catalog/infrastructure/category-repository";
import { productRepository } from "@/features/catalog/infrastructure/product-repository";
import { DeliveryProvider } from "@/features/delivery/delivery-provider";
import { serviceAreaRepository } from "@/features/delivery/service-area-repository";
import { FavoritesProvider } from "@/features/favorites/favorites-provider";
import { StorefrontInstallBanner } from "@/features/pwa/storefront-install-banner";
import { storeContactService } from "@/features/orders/application/order-service-instance";
import { StoreFooter } from "@/features/storefront/components/store-footer";
import { StoreLaunchSplash } from "@/features/storefront/components/store-launch-splash";
import { StoreNavigationProvider } from "@/features/storefront/components/store-navigation";
import { getLocale } from "@/i18n/server";

// Catalog-backed providers live here so admin and utility routes never load the catalog.
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
  await connection();
  const [products, serviceAreas, customer, categories, locale, storeWhatsApp] =
    await Promise.all([
      productRepository.list(),
      serviceAreaRepository.listEnabled(),
      getCustomerSession(),
      storefrontCategories(),
      getLocale(),
      storeContactService.whatsAppNumber(),
    ]);
  const accountFavorites = customer
    ? {
        productIds: await customerFavoritesService.list(customer.id),
        save: setFavoriteAction,
        merge: mergeFavoritesAction,
      }
    : null;
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
      <FavoritesProvider productIds={productIds} account={accountFavorites}>
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
      </FavoritesProvider>
    </DeliveryProvider>
  );
}
