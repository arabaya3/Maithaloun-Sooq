"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { ProductDetailActions } from "@/features/catalog/components/product-detail-actions";
import { ProductMedia } from "@/features/catalog/components/product-media";
import { ProductSpecifications } from "@/features/catalog/components/product-specifications";
import { VariantSelector } from "@/features/catalog/components/variant-selector";
import {
  getCategoryLabel,
  getProductDisplayName,
  type Product,
} from "@/features/catalog/domain/product";
import {
  formatVariantAttributes,
  isVariantAvailable,
  resolveVariant,
} from "@/features/catalog/domain/product-variant";
import { formatIls } from "@/shared/lib/format-currency";

export function ProductDetailPanel({
  product,
  initialVariantId,
}: {
  product: Product;
  initialVariantId?: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const queryVariant = searchParams.get("variant");

  const selectedVariant =
    resolveVariant(product.variants, queryVariant ?? initialVariantId) ??
    product.variants[0]!;
  const name = getProductDisplayName(product);
  const available = isVariantAvailable(selectedVariant);
  const attributeSummary = formatVariantAttributes(selectedVariant.attributes);

  function selectVariant(variantId: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (variantId === product.defaultVariantId) {
      params.delete("variant");
    } else {
      params.set("variant", variantId);
    }
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, {
      scroll: false,
    });
  }

  return (
    <article className="product-detail">
      <ProductMedia
        product={product}
        image={selectedVariant.image}
        className="product-detail-media"
        sizes="(min-width: 768px) 45vw, 100vw"
        enableZoom
      />
      <div className="product-detail-content">
        <span className="eyebrow">{getCategoryLabel(product.categoryId)}</span>
        <h1>
          <bdi dir="auto">{name}</bdi>
        </h1>
        <p
          className="product-detail-price"
          aria-label={`السعر ${formatIls(selectedVariant.priceAgorot)}`}
        >
          <bdi dir="ltr">{formatIls(selectedVariant.priceAgorot)}</bdi>
        </p>
        <p className="availability-status" data-available={available}>
          {available ? "متاح للإضافة إلى السلة" : "غير متاح حالياً"}
        </p>
        <VariantSelector
          variants={product.variants}
          selectedVariantId={selectedVariant.id}
          onSelect={selectVariant}
        />
        {attributeSummary ? (
          <p className="cart-line-variant">{attributeSummary}</p>
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
          variantId={selectedVariant.id}
          available={available}
        />
      </div>
    </article>
  );
}
