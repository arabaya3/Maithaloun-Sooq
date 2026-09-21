import { z } from "zod";

import { productIdSchema } from "@/features/catalog/domain/product";

export const FAVORITES_STORAGE_KEY = "souq-maythalun:favorites:v1";
const MAX_FAVORITES = 100;

const persistedFavoritesSchema = z
  .object({
    version: z.literal(1),
    productIds: z.array(productIdSchema).max(MAX_FAVORITES),
  })
  .strict();

export interface FavoritesState {
  productIds: string[];
}

export const initialFavoritesState: FavoritesState = { productIds: [] };

export function parsePersistedFavorites(
  raw: string | null,
  allowedProductIds: ReadonlySet<string>,
): FavoritesState {
  if (!raw) return initialFavoritesState;

  try {
    const parsed = persistedFavoritesSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return initialFavoritesState;

    const uniqueIds = new Set(parsed.data.productIds);
    if (
      uniqueIds.size !== parsed.data.productIds.length ||
      parsed.data.productIds.some(
        (productId) => !allowedProductIds.has(productId),
      )
    ) {
      return initialFavoritesState;
    }

    return { productIds: parsed.data.productIds };
  } catch {
    return initialFavoritesState;
  }
}

export function serializeFavorites(state: FavoritesState): string {
  return JSON.stringify({ version: 1, productIds: state.productIds });
}
