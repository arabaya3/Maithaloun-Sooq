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
import { productRepository } from "@/features/catalog/infrastructure/product-repository";
import { DeliveryProvider } from "@/features/delivery/delivery-provider";
import { serviceAreaRepository } from "@/features/delivery/service-area-repository";
import { FavoritesProvider } from "@/features/favorites/favorites-provider";
import { StorefrontInstallBanner } from "@/features/pwa/storefront-install-banner";
import { StoreFooter } from "@/features/storefront/components/store-footer";
import { StoreLaunchSplash } from "@/features/storefront/components/store-launch-splash";

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
  const [products, serviceAreas, customer] = await Promise.all([
    productRepository.list(),
    serviceAreaRepository.listEnabled(),
    getCustomerSession(),
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
        <CartProvider catalog={catalog}>{children}</CartProvider>
        <StoreFooter />
        <StorefrontInstallBanner />
      </FavoritesProvider>
    </DeliveryProvider>
  );
}
