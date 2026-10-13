"use client";

import {
  getVariantAttributeLabel,
  isVariantAvailable,
  type ProductVariant,
} from "@/features/catalog/domain/product-variant";
import { useI18n } from "@/i18n/i18n-provider";

export function VariantSelector({
  variants,
  selectedVariantId,
  onSelect,
}: {
  variants: readonly ProductVariant[];
  selectedVariantId: string;
  onSelect: (variantId: string) => void;
}) {
  const { m } = useI18n();
  if (variants.length < 2) return null;

  const attributeLabel =
    getVariantAttributeLabel(variants) ?? m.catalog.defaultAttribute;
  const sorted = [...variants].sort(
    (left, right) => left.sortOrder - right.sortOrder,
  );

  return (
    <fieldset className="variant-selector">
      <legend className="variant-selector-label">{attributeLabel}</legend>
      <div
        className="variant-selector-options"
        role="radiogroup"
        aria-label={attributeLabel}
      >
        {sorted.map((variant) => {
          const selected = variant.id === selectedVariantId;
          // Out of stock in every way of buying counts as unavailable, not just the flag.
          const unavailable = !isVariantAvailable(variant);
          return (
            <button
              key={variant.id}
              type="button"
              role="radio"
              className="variant-option"
              aria-checked={selected}
              data-selected={selected}
              disabled={unavailable && !selected}
              onClick={() => onSelect(variant.id)}
            >
              {variant.labelAr}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
