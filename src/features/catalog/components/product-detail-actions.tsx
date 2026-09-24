"use client";

import { Heart, ShoppingBasket } from "lucide-react";
import { useState } from "react";

import { QuantityControl } from "@/features/cart/components/quantity-control";
import { useCart } from "@/features/cart/cart-provider";
import {
  getProductDisplayName,
  type Product,
} from "@/features/catalog/domain/product";
import { isVariantAvailable } from "@/features/catalog/domain/product-variant";
import { useFavorites } from "@/features/favorites/favorites-provider";

export function ProductDetailActions({
  product,
  variantId,
  available,
}: {
  product: Product;
  variantId: string;
  available: boolean;
}) {
  const [quantity, setQuantity] = useState(1);
  const [confirmation, setConfirmation] = useState("");
  const { addItem } = useCart();
  const { isFavorite, toggleFavorite } = useFavorites();
  const name = getProductDisplayName(product);
  const favorite = isFavorite(product.id);
  const variant = product.variants.find((entry) => entry.id === variantId);
  const canAdd = Boolean(variant && isVariantAvailable(variant) && available);

  return (
    <div className="product-detail-actions">
      <QuantityControl
        name={name}
        quantity={quantity}
        disabled={!canAdd}
        onChange={(value) => {
          setQuantity(value);
          setConfirmation("");
        }}
      />
      <button
        type="button"
        className="add-button detail-add-button"
        disabled={!canAdd}
        onClick={() => {
          addItem(product.id, variantId, quantity);
          setConfirmation(`تمت إضافة ${name} إلى السلة.`);
        }}
      >
        <ShoppingBasket aria-hidden="true" />
        {canAdd ? "أضف إلى السلة" : "المنتج غير متاح"}
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
