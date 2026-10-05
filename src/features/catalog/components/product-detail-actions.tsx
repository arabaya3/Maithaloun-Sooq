"use client";

import { Heart, ShoppingBasket } from "lucide-react";
import { useState } from "react";

import { QuantityControl } from "@/features/cart/components/quantity-control";
import { useCart } from "@/features/cart/cart-provider";
import {
  getProductDisplayName,
  type Product,
} from "@/features/catalog/domain/product";
import {
  offerForSellingUnit,
  priceSellingUnit,
} from "@/features/catalog/domain/offer-pricing";
import { isVariantAvailable } from "@/features/catalog/domain/product-variant";
import {
  isSellingUnitPurchasable,
  piecesText,
  type SellingUnit,
} from "@/features/catalog/domain/selling-unit";
import { useFavorites } from "@/features/favorites/favorites-provider";
import { formatIls } from "@/shared/lib/format-currency";

export function ProductDetailActions({
  product,
  variantId,
  sellingUnit,
  available,
  resolveVariantId,
}: {
  product: Product;
  /** The one variant the current choices name, or null while the choice is incomplete. */
  variantId: string | null;
  /** How that variant is bought (a piece, a pack); the quantity counts these. */
  sellingUnit: SellingUnit | null;
  available: boolean;
  /** Re-reads the current choices at the moment of adding, so a stale render can never add another variant. */
  resolveVariantId: () => string | null;
}) {
  const [quantity, setQuantity] = useState(1);
  const [confirmation, setConfirmation] = useState("");
  const { addItem } = useCart();
  const { isFavorite, toggleFavorite } = useFavorites();
  const name = getProductDisplayName(product);
  const favorite = isFavorite(product.id);
  const variant = product.variants.find((entry) => entry.id === variantId);
  const canAdd = Boolean(
    variant &&
    sellingUnit &&
    isVariantAvailable(variant) &&
    isSellingUnitPurchasable(sellingUnit) &&
    available,
  );
  const max = sellingUnit?.maxQuantity ?? 1;
  const shownQuantity = Math.min(quantity, Math.max(1, max));
  const pack = sellingUnit && sellingUnit.unitsPerSale > 1 ? sellingUnit : null;
  const total =
    sellingUnit && canAdd
      ? priceSellingUnit(
          sellingUnit,
          offerForSellingUnit(sellingUnit, variant?.offer),
          shownQuantity,
        ).unitPriceAgorot * shownQuantity
      : null;

  return (
    <div className="product-detail-actions">
      <div className="detail-quantity">
        <span className="detail-quantity-label">
          {pack ? (
            <>
              العدد من «<bdi dir="auto">{pack.labelAr}</bdi>»
            </>
          ) : (
            "الكمية"
          )}
        </span>
        <QuantityControl
          name={pack ? `${name} — ${pack.labelAr}` : name}
          quantity={shownQuantity}
          max={max}
          disabled={!canAdd}
          onChange={(value) => {
            setQuantity(value);
            setConfirmation("");
          }}
        />
        {pack && total !== null ? (
          <p className="detail-quantity-summary" aria-live="polite">
            {shownQuantity} × {pack.labelAr} ={" "}
            {piecesText(shownQuantity * pack.unitsPerSale)}
            {" · "}
            <bdi dir="ltr">{formatIls(total)}</bdi>
          </p>
        ) : null}
      </div>
      <button
        type="button"
        className="add-button detail-add-button"
        disabled={!canAdd}
        onClick={() => {
          const current = resolveVariantId();
          const exact = product.variants.find((entry) => entry.id === current);
          const unit = exact?.sellingUnits.find(
            (entry) => entry.id === sellingUnit?.id,
          );
          if (
            !exact ||
            !unit ||
            current !== variantId ||
            !isVariantAvailable(exact) ||
            !isSellingUnitPurchasable(unit)
          ) {
            setConfirmation("اختر خيارات متوفرة قبل الإضافة إلى السلة.");
            return;
          }
          addItem(
            {
              productId: product.id,
              variantId: exact.id,
              sellingUnitId: unit.id,
              unitsPerSale: unit.unitsPerSale,
            },
            shownQuantity,
          );
          setConfirmation(
            pack
              ? `تمت إضافة ${name} (${pack.labelAr} × ${shownQuantity}) إلى السلة.`
              : `تمت إضافة ${name} إلى السلة.`,
          );
        }}
      >
        <ShoppingBasket aria-hidden="true" />
        {canAdd
          ? "أضف إلى السلة"
          : variantId
            ? "المنتج غير متاح"
            : "اختر من الخيارات"}
      </button>
      <button
        type="button"
        className="detail-favorite-button"
        aria-label={
          favorite ? `إزالة ${name} من المفضلة` : `إضافة ${name} إلى المفضلة`
        }
        aria-pressed={favorite}
        onClick={() => toggleFavorite(product.id)}
      >
        <Heart aria-hidden="true" className={favorite ? "fill-current" : ""} />
        {favorite ? "محفوظ في المفضلة" : "أضف إلى المفضلة"}
      </button>
      <p className="cart-confirmation" role="status" aria-live="polite">
        {confirmation}
      </p>
    </div>
  );
}
