import "server-only";

import { revalidatePath } from "next/cache";

/**
 * Storefront pages are static (app/[locale], ISR). Any change the shopper can see (product, price,
 * stock, offer, category, image, store number, delivery area) calls this so both languages are
 * re-rendered on their next visit instead of waiting for the revalidate window.
 */
export function revalidateStorefront(): void {
  revalidatePath("/[locale]", "layout");
}
