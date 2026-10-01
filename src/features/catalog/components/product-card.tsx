"use client";

import { Heart, Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { useCart } from "@/features/cart/cart-provider";
import { QuantityControl } from "@/features/cart/components/quantity-control";
import { ProductMedia } from "@/features/catalog/components/product-media";
import {
  getProductDisplayName,
  isProductAvailable,
  type Product,
} from "@/features/catalog/domain/product";
import { useFavorites } from "@/features/favorites/favorites-provider";
import { formatIls } from "@/shared/lib/format-currency";

export function ProductCard({
  product,
  priority = false,
}: {
  product: Product;
  priority?: boolean;
}) {
  const [quantity, setQuantity] = useState(1);
  const { addItem } = useCart();
  const { isFavorite, toggleFavorite } = useFavorites();
  const name = getProductDisplayName(product);
  const favorite = isFavorite(product.id);
  const available = isProductAvailable(product);
  const optionCount = product.variants.length;

  return (
    <article
      className="product-card"
      data-product-id={product.id}
      data-available={available}
    >
      <button
        type="button"
        className="icon-button favorite-button"
        aria-label={
          favorite ? `إزالة ${name} من المفضلة` : `إضافة ${name} إلى المفضلة`
        }
        aria-pressed={favorite}
        onClick={() => toggleFavorite(product.id)}
      >
        <Heart aria-hidden="true" className={favorite ? "fill-current" : ""} />
      </button>

      <Link href={`/products/${product.slug}`} className="product-card-link">
        <ProductMedia
          product={product}
          priority={priority}
          sizes="(min-width: 1024px) 252px, (min-width: 768px) 30vw, 46vw"
        />
        <div className="product-details">
          <h3>
            <bdi dir="auto">{name}</bdi>
          </h3>
          {product.unit || optionCount > 1 ? (
            <p className="product-meta">
              {product.unit ? <span>{product.unit}</span> : null}
              {optionCount > 1 ? (
                <span className="product-options">{optionCount} خيارات</span>
              ) : null}
            </p>
          ) : null}
          <p
            className="product-price"
            aria-label={`السعر ${formatIls(product.priceAgorot)}`}
          >
            <bdi dir="ltr">{formatIls(product.priceAgorot)}</bdi>
          </p>
          {available ? null : (
            <p className="product-unavailable">غير متوفر حالياً</p>
          )}
        </div>
      </Link>

      <div className="product-actions">
        {available ? (
          <QuantityControl
            name={name}
            quantity={quantity}
            onChange={setQuantity}
          />
        ) : null}
        <button
          type="button"
          className="add-button"
          disabled={!available}
          onClick={() =>
            addItem(product.id, product.defaultVariantId, quantity)
          }
        >
          {available ? (
            <>
              <Plus aria-hidden="true" />
              أضف إلى السلة
            </>
          ) : (
            "غير متاح"
          )}
        </button>
      </div>
    </article>
  );
}
