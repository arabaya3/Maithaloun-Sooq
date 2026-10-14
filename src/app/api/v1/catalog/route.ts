import { NextResponse } from "next/server";

import { storefrontCategories } from "@/features/catalog/infrastructure/category-repository";
import { productRepository } from "@/features/catalog/infrastructure/product-repository";
import {
  allowPublicApiRequest,
  apiError,
  apiLocale,
  catalogCacheHeaders,
} from "@/features/commerce/api-guard";
import {
  PUBLIC_API_VERSION,
  publicCategory,
  publicProduct,
  publicStoreInfo,
} from "@/features/commerce/public-catalog";
import { storeContactService } from "@/features/orders/application/order-service-instance";

export const dynamic = "force-dynamic";

/** Public catalog for the mobile app and the assistant: published products, categories and store rules. */
export async function GET(request: Request) {
  if (!(await allowPublicApiRequest(request, "api:catalog", 120))) {
    return apiError("rate_limited", 429);
  }
  const locale = apiLocale(request);
  const [products, categories, whatsApp] = await Promise.all([
    productRepository.list(),
    storefrontCategories(),
    storeContactService.whatsAppNumber(),
  ]);
  return NextResponse.json(
    {
      ok: true,
      version: PUBLIC_API_VERSION,
      locale,
      store: publicStoreInfo(whatsApp),
      categories: categories.map((category) =>
        publicCategory(category, locale),
      ),
      products: products.map((product) => publicProduct(product, locale)),
    },
    { headers: catalogCacheHeaders },
  );
}
