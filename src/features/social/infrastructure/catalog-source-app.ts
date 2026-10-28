import "server-only";

import { storefrontCategories } from "@/features/catalog/infrastructure/category-repository";
import { productRepository } from "@/features/catalog/infrastructure/product-repository";
import {
  publicCategory,
  publicProduct,
  publicStoreInfo,
} from "@/features/commerce/public-catalog";
import { storeContactService } from "@/features/orders/application/order-service-instance";
import { toSocialCatalog } from "@/features/social/domain/social-catalog";

import { parsePublicCatalog, type CatalogSource } from "./catalog-source";

/** Inside the app the catalog is read directly, through the same public mapping as /api/v1/catalog. */
export const appCatalogSource: CatalogSource = async () => {
  const [products, categories, whatsApp] = await Promise.all([
    productRepository.list(),
    storefrontCategories(),
    storeContactService.whatsAppNumber(),
  ]);
  return toSocialCatalog(
    parsePublicCatalog({
      ok: true,
      store: publicStoreInfo(whatsApp),
      categories: categories.map((category) => publicCategory(category, "ar")),
      products: products.map((product) => publicProduct(product, "ar")),
    }),
  );
};
