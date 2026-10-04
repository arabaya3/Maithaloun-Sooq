import { normalizeArabicText } from "@/shared/lib/normalize-arabic";

export interface OfferTargetCounts {
  productIds: readonly string[];
  variantIds: readonly string[];
  categoryCodes: readonly string[];
}

// When the owner names one variant of a multi-variant product ("مسك لافندر"), the offer must target that variant only.
export function specificVariantNamed(
  query: string,
  variants: ReadonlyArray<{ id: string; labelAr: string }>,
): string | null {
  if (variants.length < 2) return null;
  const words = ` ${normalizeArabicText(query)} `;
  const named = variants.filter((variant) => {
    const label = normalizeArabicText(variant.labelAr);
    return label.length >= 2 && words.includes(` ${label} `);
  });
  return named.length === 1 ? named[0]!.id : null;
}

// The card states exactly what the offer touches, so a title naming one variant can never hide a wider scope.
export function describeOfferScope(
  targets: OfferTargetCounts,
  variantCount: number,
  names: readonly string[] = [],
): string {
  const parts = [
    targets.productIds.length
      ? `${targets.productIds.length} منتج بكل أصنافه`
      : null,
    targets.variantIds.length
      ? `${targets.variantIds.length} صنف محدد فقط`
      : null,
    targets.categoryCodes.length
      ? `${targets.categoryCodes.length} قسم كامل`
      : null,
  ].filter(Boolean);
  const listed = names.length ? `: ${names.slice(0, 4).join("، ")}` : "";
  return `${parts.join(" + ")}${listed} — المجموع ${variantCount} ${variantCount === 1 ? "صنف" : "أصناف"}`;
}
