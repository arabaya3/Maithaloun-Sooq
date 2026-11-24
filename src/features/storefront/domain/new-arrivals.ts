import type { Product } from "@/features/catalog/domain/product";

/** A product created within this many days carries the «new» badge. */
export const NEW_PRODUCT_DAYS = 14;

/** The cut-off, computed once on the server so every card in the page agrees with it. */
export function newSince(now: Date): string {
  return new Date(now.getTime() - NEW_PRODUCT_DAYS * 86_400_000).toISOString();
}

/** Only a real creation date can make a product «new»; without one it never is. */
export function isNewArrival(
  product: Pick<Product, "createdAt">,
  since: string | null | undefined,
): boolean {
  if (!since || !product.createdAt) return false;
  const created = Date.parse(product.createdAt);
  const cutoff = Date.parse(since);
  return Number.isFinite(created) && Number.isFinite(cutoff)
    ? created >= cutoff
    : false;
}
