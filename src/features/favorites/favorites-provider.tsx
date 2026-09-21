"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
  FAVORITES_STORAGE_KEY,
  initialFavoritesState,
  parsePersistedFavorites,
  serializeFavorites,
} from "./favorites-store";

interface FavoritesContextValue {
  ready: boolean;
  isFavorite: (productId: string) => boolean;
  toggleFavorite: (productId: string) => void;
}

const FavoritesContext = createContext<FavoritesContextValue | null>(null);

export function FavoritesProvider({
  children,
  productIds,
}: {
  children: ReactNode;
  productIds: readonly string[];
}) {
  const [favoriteIds, setFavoriteIds] = useState<string[]>(
    initialFavoritesState.productIds,
  );
  const [restored, setRestored] = useState(false);
  const allowedProductIds = useMemo(() => new Set(productIds), [productIds]);

  useEffect(() => {
    const saved = parsePersistedFavorites(
      window.localStorage.getItem(FAVORITES_STORAGE_KEY),
      allowedProductIds,
    );
    queueMicrotask(() => {
      setFavoriteIds(saved.productIds);
      setRestored(true);
    });
  }, [allowedProductIds]);

  useEffect(() => {
    if (restored) {
      window.localStorage.setItem(
        FAVORITES_STORAGE_KEY,
        serializeFavorites({ productIds: favoriteIds }),
      );
    }
  }, [favoriteIds, restored]);

  const value = useMemo<FavoritesContextValue>(
    () => ({
      ready: restored,
      isFavorite: (productId) => favoriteIds.includes(productId),
      toggleFavorite: (productId) => {
        if (!allowedProductIds.has(productId)) return;
        setFavoriteIds((current) =>
          current.includes(productId)
            ? current.filter((id) => id !== productId)
            : [...current, productId],
        );
      },
    }),
    [allowedProductIds, favoriteIds, restored],
  );

  return (
    <FavoritesContext.Provider value={value}>
      {children}
    </FavoritesContext.Provider>
  );
}

export function useFavorites(): FavoritesContextValue {
  const favorites = useContext(FavoritesContext);
  if (!favorites) {
    throw new Error("useFavorites must be used within FavoritesProvider");
  }
  return favorites;
}
