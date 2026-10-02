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

export interface AccountFavorites {
  productIds: string[];
  save: (productId: string, favorite: boolean) => Promise<{ ok: boolean }>;
  merge: (
    productIds: string[],
  ) => Promise<
    { ok: true; added: number; productIds: string[] } | { ok: false }
  >;
}

interface FavoritesContextValue {
  ready: boolean;
  signedIn: boolean;
  favoriteIds: readonly string[];
  /** Saved on this device but not yet in the signed-in account. */
  deviceOnlyIds: readonly string[];
  isFavorite: (productId: string) => boolean;
  toggleFavorite: (productId: string) => void;
  mergeDeviceFavorites: () => Promise<number | null>;
}

const FavoritesContext = createContext<FavoritesContextValue | null>(null);

export function FavoritesProvider({
  children,
  productIds,
  account = null,
}: {
  children: ReactNode;
  productIds: readonly string[];
  account?: AccountFavorites | null;
}) {
  const [localIds, setLocalIds] = useState<string[]>(
    initialFavoritesState.productIds,
  );
  const [accountIds, setAccountIds] = useState<string[]>(
    account?.productIds ?? [],
  );
  const [restored, setRestored] = useState(false);
  const allowedProductIds = useMemo(() => new Set(productIds), [productIds]);
  const signedIn = account !== null;

  useEffect(() => {
    const saved = parsePersistedFavorites(
      window.localStorage.getItem(FAVORITES_STORAGE_KEY),
      allowedProductIds,
    );
    queueMicrotask(() => {
      setLocalIds(saved.productIds);
      setRestored(true);
    });
  }, [allowedProductIds]);

  useEffect(() => {
    if (restored && !signedIn) {
      window.localStorage.setItem(
        FAVORITES_STORAGE_KEY,
        serializeFavorites({ productIds: localIds }),
      );
    }
  }, [localIds, restored, signedIn]);

  const value = useMemo<FavoritesContextValue>(() => {
    const favoriteIds = signedIn ? accountIds : localIds;
    return {
      ready: restored,
      signedIn,
      favoriteIds,
      deviceOnlyIds: signedIn
        ? localIds.filter((id) => !accountIds.includes(id))
        : [],
      isFavorite: (productId) => favoriteIds.includes(productId),
      toggleFavorite: (productId) => {
        if (!allowedProductIds.has(productId)) return;
        const next = !favoriteIds.includes(productId);
        const update = (current: string[]) =>
          next
            ? [...current, productId]
            : current.filter((id) => id !== productId);
        if (!signedIn) {
          setLocalIds(update);
          return;
        }
        setAccountIds(update);
        void account?.save(productId, next).then((result) => {
          if (!result.ok) {
            setAccountIds((current) =>
              next
                ? current.filter((id) => id !== productId)
                : [...current, productId],
            );
          }
        });
      },
      mergeDeviceFavorites: async () => {
        if (!account) return null;
        const result = await account.merge(
          localIds.filter((id) => !accountIds.includes(id)),
        );
        if (!result.ok) return null;
        setAccountIds(result.productIds);
        return result.added;
      },
    };
  }, [account, accountIds, allowedProductIds, localIds, restored, signedIn]);

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
