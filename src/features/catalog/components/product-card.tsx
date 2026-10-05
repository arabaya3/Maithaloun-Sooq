"use client";

import { Heart, Minus, Plus, ShoppingCart, Trash2 } from "lucide-react";
import Link from "next/link";

import { useCart } from "@/features/cart/cart-provider";
import { MAX_CART_QUANTITY } from "@/features/cart/cart-store";
import { OfferPrice } from "@/features/catalog/components/offer-price";
import { offerForSellingUnit } from "@/features/catalog/domain/offer-pricing";
import { defaultSellingUnit } from "@/features/catalog/domain/selling-unit";
import { ProductMedia } from "@/features/catalog/components/product-media";
import {
  getProductDisplayName,
  isProductAvailable,
  type Product,
} from "@/features/catalog/domain/product";
import { useFavorites } from "@/features/favorites/favorites-provider";

export function ProductCard({ product }: { product: Product }) {
  const { lines, addItem, setQuantity, removeItem } = useCart();
  const { isFavorite, toggleFavorite } = useFavorites();
  const name = getProductDisplayName(product);
  const favorite = isFavorite(product.id);
  const optionCount = product.variants.length;
  const variantId = product.defaultVariantId;
  const variant = product.variants.find((row) => row.id === variantId);
  const unit = variant ? defaultSellingUnit(variant.sellingUnits) : null;
  const available = isProductAvailable(product);
  // The card buys the default variant its default way; other ways are chosen on the product page.
  const cardLine = unit
    ? {
        productId: product.id,
        variantId,
        sellingUnitId: unit.id,
        unitsPerSale: unit.unitsPerSale,
      }
    : null;
  const canAddFromCard = Boolean(cardLine && unit && unit.maxQuantity >= 1);
  const inCart =
    lines.find(
      (line) =>
        line.productId === product.id &&
        line.variantId === variantId &&
        line.sellingUnitId === unit?.id,
    )?.quantity ?? 0;
  const maxInCart = Math.min(MAX_CART_QUANTITY, unit?.maxQuantity ?? 0);

  return (
    <article
      className="product-card"
      data-product-id={product.id}
      data-available={available}
    >
      <div className="product-card-media">
        <ProductMedia
          product={product}
          sizes="(min-width: 64rem) 252px, (min-width: 48rem) 30vw, 120px"
        />
        <button
          type="button"
          className="icon-button favorite-button"
          aria-label={
            favorite ? `إزالة ${name} من المفضلة` : `إضافة ${name} إلى المفضلة`
          }
          aria-pressed={favorite}
          onClick={() => toggleFavorite(product.id)}
        >
          <Heart
            aria-hidden="true"
            className={favorite ? "fill-current" : ""}
          />
        </button>
      </div>

      <div className="product-details">
        <h3>
          <Link
            href={`/products/${product.slug}`}
            className="product-card-link"
          >
            <bdi dir="auto">{name}</bdi>
          </Link>
        </h3>
        {product.unit || optionCount > 1 ? (
          <p className="product-meta">
            {product.unit ? <span>{product.unit}</span> : null}
            {optionCount > 1 ? (
              <span className="product-options">{optionCount} خيارات</span>
            ) : null}
          </p>
        ) : null}
        <OfferPrice
          className="product-price"
          variant={
            unit
              ? {
                  priceAgorot: unit.priceAgorot,
                  offer: offerForSellingUnit(unit, variant?.offer),
                }
              : (variant ?? product)
          }
        />
        {unit && unit.unitsPerSale > 1 ? (
          <p className="product-meta">
            <bdi dir="auto">{unit.labelAr}</bdi>
          </p>
        ) : null}
      </div>

      <div className="product-actions">
        {!available ? (
          <p className="product-unavailable">غير متوفر حالياً</p>
        ) : !canAddFromCard || !cardLine ? (
          <Link
            href={`/products/${product.slug}`}
            className="add-button"
            aria-label={`عرض خيارات ${name}`}
          >
            عرض الخيارات
          </Link>
        ) : inCart > 0 ? (
          <div className="card-quantity" aria-label={`كمية ${name} في السلة`}>
            <button
              type="button"
              aria-label={`زيادة كمية ${name}`}
              disabled={inCart >= maxInCart}
              onClick={() => setQuantity(cardLine, inCart + 1)}
            >
              <Plus aria-hidden="true" />
            </button>
            <output aria-live="polite" aria-label={`كمية ${name} في السلة`}>
              {inCart}
            </output>
            {inCart > 1 ? (
              <button
                type="button"
                aria-label={`تقليل كمية ${name}`}
                onClick={() => setQuantity(cardLine, inCart - 1)}
              >
                <Minus aria-hidden="true" />
              </button>
            ) : (
              <button
                type="button"
                aria-label={`إزالة ${name} من السلة`}
                onClick={() => removeItem(cardLine)}
              >
                <Trash2 aria-hidden="true" />
              </button>
            )}
          </div>
        ) : (
          <button
            type="button"
            className="add-button"
            onClick={() => addItem(cardLine, 1)}
          >
            <ShoppingCart aria-hidden="true" />
            أضف إلى السلة
          </button>
        )}
      </div>
    </article>
  );
}
