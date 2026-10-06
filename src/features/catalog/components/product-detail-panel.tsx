"use client";

import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";

import { OfferPrice } from "@/features/catalog/components/offer-price";
import { OptionSelectors } from "@/features/catalog/components/option-selectors";
import { ProductDetailActions } from "@/features/catalog/components/product-detail-actions";
import {
  ProductGallery,
  type GalleryItem,
} from "@/features/catalog/components/product-gallery";
import { ProductMedia } from "@/features/catalog/components/product-media";
import { ProductSpecifications } from "@/features/catalog/components/product-specifications";
import { SellingUnitSelector } from "@/features/catalog/components/selling-unit-selector";
import { VariantSelector } from "@/features/catalog/components/variant-selector";
import { offerForSellingUnit } from "@/features/catalog/domain/offer-pricing";
import {
  getProductDisplayName,
  type Product,
} from "@/features/catalog/domain/product";
import {
  imageScopeLabel,
  resolveImage,
  selectionForImage,
} from "@/features/catalog/domain/product-media";
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
import {
  findSellingUnit,
  isSellingUnitPurchasable,
  sellingUnitAfterVariantChange,
  type SellingUnit,
} from "@/features/catalog/domain/selling-unit";

// The chosen variant and way of buying are kept in the address for sharing, without asking the server for a new page.
function rememberInAddress(key: "variant" | "unit", value: string | null) {
  const url = new URL(window.location.href);
  if (value) url.searchParams.set(key, value);
  else url.searchParams.delete(key);
  window.history.replaceState(window.history.state, "", url);
}

function rememberVariant(variantId: string, defaultVariantId: string) {
  rememberInAddress(
    "variant",
    variantId === defaultVariantId ? null : variantId,
  );
}

function rememberUnit(unit: SellingUnit | null) {
  rememberInAddress("unit", unit && !unit.isDefault ? unit.id : null);
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
  const optionOrder = useMemo(
    () => options.map((option) => option.id),
    [options],
  );
  const selectable = useMemo(
    () =>
      product.variants.map((variant) => ({
        id: variant.id,
        optionValues: presentation.variantOptions[variant.id] ?? {},
        available: isVariantAvailable(variant),
        isDefault: variant.isDefault,
      })),
    [presentation.variantOptions, product.variants],
  );
  const gallery: GalleryItem[] = useMemo(() => {
    const labelOf = (id: string) =>
      product.variants.find((variant) => variant.id === id)?.labelAr ?? null;
    return presentation.gallery.map((image) => ({
      ...image,
      scopeLabel: imageScopeLabel(image, options, labelOf),
    }));
  }, [options, presentation.gallery, product.variants]);
  const initialSelection = presentation.variantOptions[initial.id] ?? {};
  const pickImage = (variantId: string | null, chosen: OptionSelection) =>
    resolveImage(gallery, { variantId, selection: chosen, optionOrder })?.id ??
    null;
  const [initialImageId] = useState(() =>
    pickImage(initial.id, initialSelection),
  );
  const [variantId, setVariantId] = useState(initial.id);
  const [selection, setSelection] = useState<OptionSelection>(initialSelection);
  const [imageId, setImageId] = useState<string | null>(initialImageId);
  // The chosen way of buying, plus its size so an equivalent unit survives a colour or size change.
  const [chosenUnit, setChosenUnit] = useState<{
    id: string;
    unitsPerSale: number;
  } | null>(() => {
    const unit = findSellingUnit(
      initial.sellingUnits,
      searchParams.get("unit"),
    );
    return unit ? { id: unit.id, unitsPerSale: unit.unitsPerSale } : null;
  });

  const optionVariant = options.length
    ? variantForSelection(options, selectable, selection)
    : null;
  // With options, only a complete selection that names one existing variant can be bought.
  const selectedVariant = options.length
    ? (product.variants.find((variant) => variant.id === optionVariant?.id) ??
      null)
    : (product.variants.find((variant) => variant.id === variantId) ?? initial);
  const shown = selectedVariant ?? initial;
  const name = getProductDisplayName(product);
  const available =
    !presentation.incomplete &&
    Boolean(selectedVariant) &&
    isVariantAvailable(selectedVariant!);
  const attributeSummary = options.length
    ? null
    : formatVariantAttributes(shown.attributes);
  const pack = packLabel(presentation.packCounts[shown.id]);
  const exactUnit = findSellingUnit(shown.sellingUnits, chosenUnit?.id);
  const sellingUnit: SellingUnit | null =
    exactUnit && isSellingUnitPurchasable(exactUnit)
      ? exactUnit
      : sellingUnitAfterVariantChange(chosenUnit, shown.sellingUnits);
  const priceShown = sellingUnit
    ? {
        priceAgorot: sellingUnit.priceAgorot,
        offer: offerForSellingUnit(sellingUnit, shown.offer),
      }
    : shown;
  const activeImage =
    gallery.find((image) => image.id === imageId) ?? gallery[0] ?? null;

  // The way of buying the customer now sees becomes their choice, so going back never revives an old one.
  function settleUnit(nextVariantId: string | null | undefined) {
    const next = product.variants.find((row) => row.id === nextVariantId);
    if (!next) return;
    const unit = sellingUnitAfterVariantChange(sellingUnit, next.sellingUnits);
    setChosenUnit(
      unit ? { id: unit.id, unitsPerSale: unit.unitsPerSale } : null,
    );
    rememberUnit(unit);
  }

  function chooseUnit(unit: SellingUnit) {
    setChosenUnit({ id: unit.id, unitsPerSale: unit.unitsPerSale });
    rememberUnit(unit);
  }

  function chooseVariant(id: string) {
    settleUnit(id);
    setVariantId(id);
    setImageId(pickImage(id, presentation.variantOptions[id] ?? {}));
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
    const match = variantForSelection(options, selectable, next);
    setSelection(next);
    setImageId(pickImage(match?.id ?? null, next));
    if (match) rememberVariant(match.id, product.defaultVariantId);
    settleUnit(match?.id);
  }

  // Tapping a colour or variant picture selects exactly what it shows; a shared picture only changes the view.
  function chooseImage(image: GalleryItem) {
    setImageId(image.id);
    const picked = selectionForImage(image, options, selectable, selection);
    if (picked.kind === "none") return;
    settleUnit(picked.variantId);
    if (options.length) setSelection(picked.selection);
    else setVariantId(picked.variantId);
    rememberVariant(picked.variantId, product.defaultVariantId);
  }

  return (
    <article className="product-detail">
      {gallery.length > 1 ? (
        <ProductGallery
          images={gallery}
          activeId={activeImage?.id ?? null}
          priorityId={initialImageId}
          label={`صور ${name}`}
          onSelect={chooseImage}
        />
      ) : (
        <ProductMedia
          product={product}
          image={
            gallery[0]
              ? {
                  kind: "image",
                  src: gallery[0].src,
                  alt: gallery[0].alt,
                  width: gallery[0].width,
                  height: gallery[0].height,
                }
              : shown.image
          }
          className="product-detail-media"
          sizes="(min-width: 768px) 45vw, 100vw"
          priority
          enableZoom
        />
      )}
      <div className="product-detail-content">
        <span className="eyebrow">{categoryLabel}</span>
        <h1>
          <bdi dir="auto">{name}</bdi>
        </h1>
        <OfferPrice className="product-detail-price" variant={priceShown} />
        <p className="availability-status" data-available={available}>
          {presentation.incomplete
            ? "غير متاح حالياً، نجهّز خيارات هذا المنتج"
            : !selectedVariant
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
        {selectedVariant ? (
          <SellingUnitSelector
            units={shown.sellingUnits}
            selectedId={sellingUnit?.id ?? null}
            offer={shown.offer}
            onSelect={chooseUnit}
          />
        ) : null}
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
          variantId={
            presentation.incomplete ? shown.id : (selectedVariant?.id ?? null)
          }
          sellingUnit={sellingUnit}
          available={available}
          resolveVariantId={() =>
            options.length
              ? (variantForSelection(options, selectable, selection)?.id ??
                null)
              : variantId
          }
        />
      </div>
    </article>
  );
}
