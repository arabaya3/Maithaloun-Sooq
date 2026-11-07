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
  ACCOUNT_PROBED_STORAGE_KEY,
  hasSignedInMarker,
  onAccountMaybeChanged,
} from "@/features/accounts/domain/signed-in-marker";

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

/** Server actions for an account that the browser discovers after the cached page loads. */
export interface AccountFavoritesActions {
  load: () => Promise<
    { signedIn: false } | { signedIn: true; productIds: string[] }
  >;
  save: AccountFavorites["save"];
  merge: AccountFavorites["merge"];
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
  account: givenAccount = null,
  accountActions = null,
}: {
  children: ReactNode;
  productIds: readonly string[];
  account?: AccountFavorites | null;
  accountActions?: AccountFavoritesActions | null;
}) {
  const [loadedAccount, setLoadedAccount] = useState<AccountFavorites | null>(
    null,
  );
  const account = givenAccount ?? loadedAccount;
  const [localIds, setLocalIds] = useState<string[]>(
    initialFavoritesState.productIds,
  );
  const [accountIds, setAccountIds] = useState<string[]>(
    account?.productIds ?? [],
  );
  const [restored, setRestored] = useState(false);
  const allowedProductIds = useMemo(() => new Set(productIds), [productIds]);
  const signedIn = account !== null;

  // Only browsers that may hold a session ask; anonymous visitors are checked once at most. It is
  // checked again after signing in or out, so the change shows without a full reload.
  const [accountCheck, setAccountCheck] = useState(0);
  useEffect(
    () => onAccountMaybeChanged(() => setAccountCheck((count) => count + 1)),
    [],
  );
  const hasLoadedAccount = loadedAccount !== null;
  useEffect(() => {
    if (!accountActions || givenAccount) return;
    const marked = hasSignedInMarker(document.cookie);
    if (hasLoadedAccount) {
      if (!marked) queueMicrotask(() => setLoadedAccount(null));
      return;
    }
    let probed = false;
    try {
      probed = window.localStorage.getItem(ACCOUNT_PROBED_STORAGE_KEY) === "1";
    } catch {}
    if (!marked && probed) return;
    let cancelled = false;
    void accountActions
      .load()
      .then((result) => {
        if (cancelled) return;
        if (!result.signedIn) {
          try {
            window.localStorage.setItem(ACCOUNT_PROBED_STORAGE_KEY, "1");
          } catch {}
          return;
        }
        setAccountIds(result.productIds);
        setLoadedAccount({
          productIds: result.productIds,
          save: accountActions.save,
          merge: accountActions.merge,
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [accountActions, givenAccount, hasLoadedAccount, accountCheck]);

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
