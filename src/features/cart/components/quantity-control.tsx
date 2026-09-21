"use client";

import { Minus, Plus } from "lucide-react";

import { MAX_CART_QUANTITY } from "@/features/cart/cart-store";

export function QuantityControl({
  name,
  quantity,
  disabled = false,
  onChange,
}: {
  name: string;
  quantity: number;
  disabled?: boolean;
  onChange: (quantity: number) => void;
}) {
  return (
    <div className="quantity-control" aria-label={`كمية ${name}`}>
      <button
        type="button"
        aria-label={`تقليل كمية ${name}`}
        disabled={disabled || quantity <= 1}
        onClick={() => onChange(Math.max(1, quantity - 1))}
      >
        <Minus aria-hidden="true" />
      </button>
      <output aria-live="polite" aria-label={`كمية ${name} الحالية`}>
        {quantity}
      </output>
      <button
        type="button"
        aria-label={`زيادة كمية ${name}`}
        disabled={disabled || quantity >= MAX_CART_QUANTITY}
        onClick={() => onChange(Math.min(MAX_CART_QUANTITY, quantity + 1))}
      >
        <Plus aria-hidden="true" />
      </button>
    </div>
  );
}
