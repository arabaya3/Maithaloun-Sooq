import { NextResponse } from "next/server";

import { productRepository } from "@/features/catalog/infrastructure/product-repository";
import {
  allowPublicApiRequest,
  apiError,
  apiLocale,
  catalogCacheHeaders,
} from "@/features/commerce/api-guard";
import { publicProduct } from "@/features/commerce/public-catalog";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  if (!(await allowPublicApiRequest(request, "api:product", 240))) {
    return apiError("rate_limited", 429);
  }
  const { slug } = await params;
  if (!/^[a-z0-9-]{1,120}$/.test(slug)) return apiError("not_found", 404);
  const product = (await productRepository.list()).find(
    (item) => item.slug === slug,
  );
  if (!product) return apiError("not_found", 404);
  return NextResponse.json(
    { ok: true, product: publicProduct(product, apiLocale(request)) },
    { headers: catalogCacheHeaders },
  );
}
