"use client";

import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";

import { OfferPrice } from "@/features/catalog/components/offer-price";
import { OptionSelectors } from "@/features/catalog/components/option-selectors";
import { ProductDetailActions } from "@/features/catalog/components/product-detail-actions";
import { ProductGallery } from "@/features/catalog/components/product-gallery";
import { ProductMedia } from "@/features/catalog/components/product-media";
import { ProductSpecifications } from "@/features/catalog/components/product-specifications";
import { VariantSelector } from "@/features/catalog/components/variant-selector";
import {
  getProductDisplayName,
  type Product,
} from "@/features/catalog/domain/product";
import { galleryForVariant } from "@/features/catalog/domain/product-gallery";
import {
  nextSelection,
  packLabel,
  variantForSelection,
  type OptionSelection,
} from "@/features/catalog/domain/product-options";
import {
  formatVariantAttributes,
  isVariantAvailable,
  resolveVariant,
} from "@/features/catalog/domain/product-variant";
import {
  emptyPresentation,
  type ProductPresentation,
} from "@/features/catalog/domain/product-presentation";

// The chosen variant is kept in the address for sharing, without asking the server for a new page.
function rememberVariant(variantId: string, defaultVariantId: string) {
  const url = new URL(window.location.href);
  if (variantId === defaultVariantId) url.searchParams.delete("variant");
  else url.searchParams.set("variant", variantId);
  window.history.replaceState(window.history.state, "", url);
}

export function ProductDetailPanel({
  product,
  categoryLabel,
  initialVariantId,
  presentation = emptyPresentation,
}: {
  product: Product;
  categoryLabel: string;
  initialVariantId?: string | null;
  presentation?: ProductPresentation;
}) {
  const searchParams = useSearchParams();
  const initial =
    resolveVariant(
      product.variants,
      searchParams.get("variant") ?? initialVariantId,
    ) ?? product.variants[0]!;
  const options = presentation.options;
  const selectable = useMemo(
    () =>
      product.variants.map((variant) => ({
        id: variant.id,
        optionValues: presentation.variantOptions[variant.id] ?? {},
        available: isVariantAvailable(variant),
      })),
    [presentation.variantOptions, product.variants],
  );
  const [variantId, setVariantId] = useState(initial.id);
  const [selection, setSelection] = useState<OptionSelection>(
    presentation.variantOptions[initial.id] ?? {},
  );

  const optionVariant = options.length
    ? variantForSelection(options, selectable, selection)
    : null;
  const selectedVariant = options.length
    ? (product.variants.find((variant) => variant.id === optionVariant?.id) ??
      null)
    : (product.variants.find((variant) => variant.id === variantId) ?? initial);
  const shown = selectedVariant ?? initial;
  const name = getProductDisplayName(product);
  const available = Boolean(selectedVariant) && isVariantAvailable(shown);
  const attributeSummary = options.length
    ? null
    : formatVariantAttributes(shown.attributes);
  const pack = packLabel(presentation.packCounts[shown.id]);
  const gallery = galleryForVariant(presentation.gallery, shown.id);

  function chooseVariant(id: string) {
    setVariantId(id);
    rememberVariant(id, product.defaultVariantId);
  }

  function chooseValue(optionId: string, valueId: string) {
    const next = nextSelection(
      options,
      selectable,
      selection,
      optionId,
      valueId,
    );
    setSelection(next);
    const match = variantForSelection(options, selectable, next);
    if (match) rememberVariant(match.id, product.defaultVariantId);
  }

  return (
    <article className="product-detail">
      {gallery.length > 1 ? (
        <ProductGallery images={gallery} label={`صور ${name}`} />
      ) : (
        <ProductMedia
          product={product}
          image={gallery[0] ? { kind: "image", ...gallery[0] } : shown.image}
          className="product-detail-media"
          sizes="(min-width: 768px) 45vw, 100vw"
          enableZoom
        />
      )}
      <div className="product-detail-content">
        <span className="eyebrow">{categoryLabel}</span>
        <h1>
          <bdi dir="auto">{name}</bdi>
        </h1>
        <OfferPrice className="product-detail-price" variant={shown} />
        <p className="availability-status" data-available={available}>
          {!selectedVariant
            ? "اختر من الخيارات لمعرفة التوفر"
            : available
              ? "متاح للإضافة إلى السلة"
              : "غير متاح حالياً"}
        </p>
        {options.length ? (
          <OptionSelectors
            options={options}
            variants={selectable}
            selection={selection}
            onSelect={chooseValue}
          />
        ) : (
          <VariantSelector
            variants={product.variants}
            selectedVariantId={shown.id}
            onSelect={chooseVariant}
          />
        )}
        {attributeSummary ? (
          <p className="cart-line-variant">{attributeSummary}</p>
        ) : null}
        {pack ? <p className="cart-line-variant">{pack}</p> : null}
        <p className="product-description">
          {product.description ??
            "تتوفر معلومات المنتج الأساسية المعروضة حالياً، وستُضاف التفاصيل بعد اعتمادها."}
        </p>
        {product.usageNotes ? (
          <section aria-labelledby="usage-title">
            <h2 id="usage-title">ملاحظات الاستخدام</h2>
            <p>{product.usageNotes}</p>
          </section>
        ) : null}
        <ProductSpecifications specifications={product.specifications} />
        <ProductDetailActions
          product={product}
          variantId={shown.id}
          available={available}
        />
      </div>
    </article>
  );
}
