import { NextResponse } from "next/server";

import {
  allowPublicApiRequest,
  apiError,
  apiLocale,
  noStoreHeaders,
  readJsonBody,
} from "@/features/commerce/api-guard";
import {
  publicQuote,
  quoteRequestSchema,
} from "@/features/commerce/public-quote";
import {
  CartPricingError,
  priceCart,
} from "@/features/orders/application/cart-pricing";
import { db } from "@/server/db/db";

export const dynamic = "force-dynamic";

const MAX_QUOTE_BYTES = 20_000;

/**
 * Prices a cart with the same server logic as order creation. It never creates an order,
 * reserves stock or changes anything.
 */
export async function POST(request: Request) {
  if (!(await allowPublicApiRequest(request, "api:quote", 60))) {
    return apiError("rate_limited", 429);
  }
  const body = await readJsonBody(request, MAX_QUOTE_BYTES);
  if (!body.ok) return apiError(body.code, body.status);
  const parsed = quoteRequestSchema.safeParse(body.value);
  if (!parsed.success) return apiError("invalid_cart", 400);
  try {
    const priced = await priceCart(db, parsed.data.items);
    return NextResponse.json(
      { ok: true, quote: publicQuote(priced, apiLocale(request)) },
      { headers: noStoreHeaders },
    );
  } catch (error) {
    if (error instanceof CartPricingError) return apiError(error.code, 409);
    throw error;
  }
}
