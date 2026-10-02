"use client";

import { Heart } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { ProductCard } from "@/features/catalog/components/product-card";
import {
  getProductDisplayName,
  type Product,
} from "@/features/catalog/domain/product";
import { formatProductCount } from "@/shared/lib/format-product-count";

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
            name: getProductDisplayName(product),
          })),
        ),
      );
    } catch {
      // Storage can be unavailable; the offline list is a convenience only.
    }
  }, [favorites, ready, signedIn]);

  async function merge() {
    setMergeState("pending");
    const added = await mergeDeviceFavorites();
    setMergeState(added === null ? "failed" : { added });
  }

  return (
    <>
      <div className="section-heading">
        <h1>المفضلة</h1>
        {ready ? (
          <span className="results-count" aria-live="polite">
            {formatProductCount(favorites.length)}
          </span>
        ) : null}
      </div>

      {signedIn &&
      (deviceOnlyIds.length > 0 || typeof mergeState === "object") &&
      mergeState !== "dismissed" ? (
        <section className="account-card account-suggestion" aria-live="polite">
          {typeof mergeState === "object" ? (
            <p className="account-note">
              أضفنا منتجات هذا الجهاز إلى مفضلتك ({mergeState.added}).
            </p>
          ) : (
            <>
              <p className="account-note">
                لديك منتجات مفضلة محفوظة على هذا الجهاز فقط (
                {deviceOnlyIds.length}). هل تريد إضافتها إلى حسابك؟ لن نحذف أي
                منتج من مفضلتك.
              </p>
              {mergeState === "failed" ? (
                <p className="account-message" role="alert">
                  تعذّرت الإضافة. حاول مرة أخرى.
                </p>
              ) : null}
              <div className="account-row-actions">
                <button
                  type="button"
                  className="account-primary"
                  disabled={mergeState === "pending"}
                  onClick={() => void merge()}
                >
                  إضافة إلى حسابي
                </button>
                <button
                  type="button"
                  className="account-secondary"
                  onClick={() => setMergeState("dismissed")}
                >
                  ليس الآن
                </button>
              </div>
            </>
          )}
        </section>
      ) : null}

      {!signedIn && accountsEnabled ? (
        <p className="account-note account-inline-suggestion">
          المفضلة محفوظة على هذا الجهاز.{" "}
          <Link href="/account?next=/favorites">سجّل الدخول</Link> لحفظها في
          حسابك والوصول إليها من أي جهاز.
        </p>
      ) : null}

      {retiredNames.length ? (
        <p className="account-note" role="status">
          لم تعد هذه المنتجات معروضة في المتجر: {retiredNames.join("، ")}.
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
          <h3>لا توجد منتجات في المفضلة</h3>
          <p>اضغط على رمز القلب في أي منتج لحفظه هنا.</p>
          <Link href="/">تصفح المنتجات</Link>
        </div>
      )}
    </>
  );
}
