import {
  offerLabel,
  priceForQuantity,
  type VariantOffer,
} from "@/features/catalog/domain/offer-pricing";
import { formatIls } from "@/shared/lib/format-currency";

export function OfferPrice({
  variant,
  className,
}: {
  variant: { priceAgorot: number; offer?: VariantOffer };
  className: string;
}) {
  const priced = priceForQuantity(variant, 1);
  const label = variant.offer ? offerLabel(variant.offer) : null;
  const current = formatIls(priced.unitPriceAgorot);
  return (
    <p
      className={className}
      aria-label={
        priced.offerId
          ? `السعر ${current} بدلاً من ${formatIls(priced.listUnitPriceAgorot)}`
          : `السعر ${current}`
      }
    >
      <bdi dir="ltr">{current}</bdi>
      {priced.offerId ? (
        <del className="price-was" aria-hidden="true">
          <bdi dir="ltr">{formatIls(priced.listUnitPriceAgorot)}</bdi>
        </del>
      ) : null}
      {label ? (
        <span
          className="offer-badge"
          aria-hidden={priced.offerId ? undefined : true}
        >
          {label}
        </span>
      ) : null}
    </p>
  );
}
