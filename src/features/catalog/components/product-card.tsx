"use client";

import { Heart, Minus, Plus, ShoppingCart, Trash2 } from "lucide-react";
import Link from "next/link";

import { useCart } from "@/features/cart/cart-provider";
import { MAX_CART_QUANTITY } from "@/features/cart/cart-store";
import { OfferPrice } from "@/features/catalog/components/offer-price";
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
  const available = isProductAvailable(product);
  const optionCount = product.variants.length;
  const variantId = product.defaultVariantId;
  const inCart =
    lines.find(
      (line) => line.productId === product.id && line.variantId === variantId,
    )?.quantity ?? 0;

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
            product.variants.find(
              (row) => row.id === product.defaultVariantId,
            ) ?? product
          }
        />
      </div>

      <div className="product-actions">
        {!available ? (
          <p className="product-unavailable">غير متوفر حالياً</p>
        ) : inCart > 0 ? (
          <div className="card-quantity" aria-label={`كمية ${name} في السلة`}>
            <button
              type="button"
              aria-label={`زيادة كمية ${name}`}
              disabled={inCart >= MAX_CART_QUANTITY}
              onClick={() => setQuantity(product.id, variantId, inCart + 1)}
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
                onClick={() => setQuantity(product.id, variantId, inCart - 1)}
              >
                <Minus aria-hidden="true" />
              </button>
            ) : (
              <button
                type="button"
                aria-label={`إزالة ${name} من السلة`}
                onClick={() => removeItem(product.id, variantId)}
              >
                <Trash2 aria-hidden="true" />
              </button>
            )}
          </div>
        ) : (
          <button
            type="button"
            className="add-button"
            onClick={() => addItem(product.id, variantId, 1)}
          >
            <ShoppingCart aria-hidden="true" />
            أضف إلى السلة
          </button>
        )}
      </div>
    </article>
  );
}
