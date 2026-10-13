"use client";

import { Heart } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { ProductCard } from "@/features/catalog/components/product-card";
import {
  localizedProductName,
  type Product,
} from "@/features/catalog/domain/product";
import { useI18n } from "@/i18n/i18n-provider";
import { Link } from "@/i18n/link";

import { useFavorites } from "./favorites-provider";
import { FAVORITES_SNAPSHOT_KEY } from "./favorites-snapshot";

export function FavoritesView({
  products,
  accountsEnabled,
  retiredNames,
}: {
  products: readonly Product[];
  accountsEnabled: boolean;
  retiredNames: readonly string[];
}) {
  const { m, locale } = useI18n();
  const t = m.account;
  const { ready, signedIn, favoriteIds, deviceOnlyIds, mergeDeviceFavorites } =
    useFavorites();
  const [mergeState, setMergeState] = useState<
    "idle" | "pending" | "dismissed" | { added: number } | "failed"
  >("idle");
  const byId = useMemo(
    () => new Map(products.map((product) => [product.id, product])),
    [products],
  );
  const favorites = favoriteIds.flatMap((id) => byId.get(id) ?? []);

  useEffect(() => {
    if (!ready || signedIn) return;
    try {
      window.localStorage.setItem(
        FAVORITES_SNAPSHOT_KEY,
        JSON.stringify(
          favorites.map((product) => ({
            id: product.id,
            name: localizedProductName(product, locale),
          })),
        ),
      );
    } catch {
      // Storage can be unavailable; the offline list is a convenience only.
    }
  }, [favorites, locale, ready, signedIn]);

  async function merge() {
    setMergeState("pending");
    const added = await mergeDeviceFavorites();
    setMergeState(added === null ? "failed" : { added });
  }

  return (
    <>
      <div className="section-heading">
        <h1>{t.favoritesTitle}</h1>
        {ready ? (
          <span className="results-count" aria-live="polite">
            {m.common.productCount(favorites.length)}
          </span>
        ) : null}
      </div>

      {signedIn &&
      (deviceOnlyIds.length > 0 || typeof mergeState === "object") &&
      mergeState !== "dismissed" ? (
        <section className="account-card account-suggestion" aria-live="polite">
          {typeof mergeState === "object" ? (
            <p className="account-note">
              {t.mergedFavorites(mergeState.added)}
            </p>
          ) : (
            <>
              <p className="account-note">
                {t.deviceFavorites(deviceOnlyIds.length)}
              </p>
              {mergeState === "failed" ? (
                <p className="account-message" role="alert">
                  {t.mergeFailed}
                </p>
              ) : null}
              <div className="account-row-actions">
                <button
                  type="button"
                  className="account-primary"
                  disabled={mergeState === "pending"}
                  onClick={() => void merge()}
                >
                  {t.addToAccount}
                </button>
                <button
                  type="button"
                  className="account-secondary"
                  onClick={() => setMergeState("dismissed")}
                >
                  {t.notNow}
                </button>
              </div>
            </>
          )}
        </section>
      ) : null}

      {!signedIn && accountsEnabled ? (
        <p className="account-note account-inline-suggestion">
          {t.favoritesOnDevice}{" "}
          <Link href="/account?next=/favorites">{t.signIn}</Link>{" "}
          {t.favoritesSignInRest}
        </p>
      ) : null}

      {retiredNames.length ? (
        <p className="account-note" role="status">
          {t.retired(retiredNames)}
        </p>
      ) : null}

      {!ready ? null : favorites.length ? (
        <div className="product-grid">
          {favorites.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      ) : (
        <div className="empty-state" role="status">
          <Heart aria-hidden="true" />
          <h3>{t.favoritesEmpty}</h3>
          <p>{t.favoritesEmptyHint}</p>
          <Link href="/">{t.browseProducts}</Link>
        </div>
      )}
    </>
  );
}
