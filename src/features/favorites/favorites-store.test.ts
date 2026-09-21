import { describe, expect, it } from "vitest";

import {
  initialFavoritesState,
  parsePersistedFavorites,
} from "./favorites-store";

describe("favorites persistence", () => {
  const productIds = new Set(["general-cleaner", "dolphin-bleach"]);

  it("restores validated product IDs", () => {
    expect(
      parsePersistedFavorites(
        JSON.stringify({
          version: 1,
          productIds: ["general-cleaner"],
        }),
        productIds,
      ),
    ).toEqual({ productIds: ["general-cleaner"] });
  });

  it("rejects corrupted, duplicated, unknown, and oversized values", () => {
    expect(parsePersistedFavorites("bad-json", productIds)).toEqual(
      initialFavoritesState,
    );
    expect(
      parsePersistedFavorites(
        JSON.stringify({
          version: 1,
          productIds: ["general-cleaner", "general-cleaner"],
        }),
        productIds,
      ),
    ).toEqual(initialFavoritesState);
    expect(
      parsePersistedFavorites(
        JSON.stringify({ version: 1, productIds: ["unknown-product"] }),
        productIds,
      ),
    ).toEqual(initialFavoritesState);
    expect(
      parsePersistedFavorites(
        JSON.stringify({
          version: 1,
          productIds: Array.from(
            { length: 101 },
            (_, index) => `item-${index}`,
          ),
        }),
        productIds,
      ),
    ).toEqual(initialFavoritesState);
  });
});
