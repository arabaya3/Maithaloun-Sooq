"use client";

import { Heart, Minus, Plus, ShoppingBasket } from "lucide-react";
import Image from "next/image";
import { useState } from "react";

import { useCart } from "@/features/cart/cart-provider";
import { ProductPlaceholder } from "@/features/catalog/components/product-placeholder";
import type { Product } from "@/features/catalog/domain/product";
import { formatIls } from "@/shared/lib/format-currency";

export function ProductCard({ product }: { product: Product }) {
  const [favorite, setFavorite] = useState(false);
  const [quantity, setQuantity] = useState(1);
  const { addItem } = useCart();

  return (
    <article className="product-card" data-product-id={product.id}>
      <button
        type="button"
        className="icon-button favorite-button"
        aria-label={
          favorite
            ? `إزالة ${product.name} من المفضلة`
            : `إضافة ${product.name} إلى المفضلة`
        }
        aria-pressed={favorite}
        onClick={() => setFavorite((value) => !value)}
      >
        <Heart aria-hidden="true" className={favorite ? "fill-current" : ""} />
      </button>

      {product.image.kind === "image" ? (
        <div className="product-art">
          <Image
            src={product.image.src}
            alt={product.image.alt}
            fill
            sizes="(min-width: 1024px) 25vw, (min-width: 768px) 33vw, 50vw"
          />
        </div>
      ) : (
        <div className="product-art">
          <ProductPlaceholder kind={product.image.variant} />
        </div>
      )}

      <div className="product-details">
        <h3>
          <bdi dir="auto">{product.name}</bdi>
        </h3>
        <p
          className="product-price"
          aria-label={`السعر ${formatIls(product.priceIls)}`}
        >
          <bdi dir="ltr">{formatIls(product.priceIls)}</bdi>
        </p>
      </div>

      <div className="product-actions">
        <div className="quantity-control" aria-label={`كمية ${product.name}`}>
          <button
            type="button"
            aria-label={`تقليل كمية ${product.name}`}
            disabled={!product.purchasable || quantity === 1}
            onClick={() => setQuantity((value) => Math.max(1, value - 1))}
          >
            <Minus aria-hidden="true" />
          </button>
          <output aria-live="polite" aria-label="الكمية">
            {quantity}
          </output>
          <button
            type="button"
            aria-label={`زيادة كمية ${product.name}`}
            disabled={!product.purchasable || quantity === 9}
            onClick={() => setQuantity((value) => Math.min(9, value + 1))}
          >
            <Plus aria-hidden="true" />
          </button>
        </div>
        <button
          type="button"
          className="add-button"
          disabled={!product.purchasable}
          onClick={() => addItem(product.id, quantity)}
        >
          <ShoppingBasket aria-hidden="true" />
          {product.purchasable ? "أضف" : "غير متاح"}
        </button>
      </div>
    </article>
  );
}
