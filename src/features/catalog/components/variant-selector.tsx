"use client";

import {
  getVariantAttributeLabel,
  type ProductVariant,
} from "@/features/catalog/domain/product-variant";

export function VariantSelector({
  variants,
  selectedVariantId,
  onSelect,
}: {
  variants: readonly ProductVariant[];
  selectedVariantId: string;
  onSelect: (variantId: string) => void;
}) {
  if (variants.length < 2) return null;

  const attributeLabel = getVariantAttributeLabel(variants) ?? "الخيار";
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
          const unavailable = variant.availability !== "available";
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
