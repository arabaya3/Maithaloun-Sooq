"use client";

import { Minus, Plus } from "lucide-react";

import { MAX_CART_QUANTITY } from "@/features/cart/cart-store";
import { useI18n } from "@/i18n/i18n-provider";

export function QuantityControl({
  name,
  quantity,
  max = MAX_CART_QUANTITY,
  disabled = false,
  onChange,
}: {
  name: string;
  quantity: number;
  // Lower than the cart limit when stock allows fewer singles or packs.
  max?: number;
  disabled?: boolean;
  onChange: (quantity: number) => void;
}) {
  const { m } = useI18n();
  return (
    <div className="quantity-control" aria-label={m.catalog.quantityOf(name)}>
      <button
        type="button"
        aria-label={m.catalog.decreaseQuantity(name)}
        disabled={disabled || quantity <= 1}
        onClick={() => onChange(Math.max(1, quantity - 1))}
      >
        <Minus aria-hidden="true" />
      </button>
      <output aria-live="polite" aria-label={m.catalog.currentQuantity(name)}>
        {quantity}
      </output>
      <button
        type="button"
        aria-label={m.catalog.increaseQuantity(name)}
        disabled={disabled || quantity >= Math.min(max, MAX_CART_QUANTITY)}
        onClick={() => onChange(Math.min(max, MAX_CART_QUANTITY, quantity + 1))}
      >
        <Plus aria-hidden="true" />
      </button>
    </div>
  );
}
