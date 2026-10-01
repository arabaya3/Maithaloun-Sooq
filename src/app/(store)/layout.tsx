import { connection } from "next/server";
import type { ReactNode } from "react";
import { preload } from "react-dom";

import { CartProvider } from "@/features/cart/cart-provider";
import { productRepository } from "@/features/catalog/infrastructure/product-repository";
import { DeliveryProvider } from "@/features/delivery/delivery-provider";
import { serviceAreaRepository } from "@/features/delivery/service-area-repository";
import { FavoritesProvider } from "@/features/favorites/favorites-provider";
import { StorefrontInstallBanner } from "@/features/pwa/storefront-install-banner";

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
  const [products, serviceAreas] = await Promise.all([
    productRepository.list(),
    serviceAreaRepository.listEnabled(),
  ]);
  const productIds = products.map((product) => product.id);
  const catalog = products.map((product) => ({
    productId: product.id,
    defaultVariantId: product.defaultVariantId,
    variantIds: product.variants.map((variant) => variant.id),
  }));
  const locations = serviceAreas.map((area) => ({
    code: area.code,
    nameAr: area.nameAr,
  }));

  return (
    <DeliveryProvider locations={locations}>
      <FavoritesProvider productIds={productIds}>
        <CartProvider catalog={catalog}>{children}</CartProvider>
        <StorefrontInstallBanner />
      </FavoritesProvider>
    </DeliveryProvider>
  );
}
