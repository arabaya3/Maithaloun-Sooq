import { z } from "zod";

export const offerKinds = ["percentage", "amount_off", "fixed_price"] as const;
export type OfferKind = (typeof offerKinds)[number];

export const variantOfferSchema = z
  .object({
    offerId: z.string().min(1),
    nameAr: z.string().min(1),
    displayText: z.string().nullable(),
    kind: z.enum(offerKinds),
    value: z.number().int().positive(),
    minQuantity: z.number().int().min(1).max(100),
    endsAt: z.string().nullable(),
  })
  .strict();
export type VariantOffer = z.infer<typeof variantOfferSchema>;

// Integer agorot only; an offer that would not lower the price, or would make it zero or negative, does not apply.
export function offerUnitPrice(
  listPriceAgorot: number,
  offer: Pick<VariantOffer, "kind" | "value">,
): number | null {
  const final =
    offer.kind === "percentage"
      ? Math.round((listPriceAgorot * (100 - offer.value)) / 100)
      : offer.kind === "amount_off"
        ? listPriceAgorot - offer.value
        : offer.value;
  return Number.isSafeInteger(final) && final > 0 && final < listPriceAgorot
    ? final
    : null;
}

export interface PricedUnit {
  unitPriceAgorot: number;
  listUnitPriceAgorot: number;
  offerId: string | null;
}

export function priceForQuantity(
  variant: { priceAgorot: number; offer?: VariantOffer },
  quantity: number,
): PricedUnit {
  const offer = variant.offer;
  const discounted =
    offer && quantity >= offer.minQuantity
      ? offerUnitPrice(variant.priceAgorot, offer)
      : null;
  return {
    unitPriceAgorot: discounted ?? variant.priceAgorot,
    listUnitPriceAgorot: variant.priceAgorot,
    offerId: discounted === null ? null : offer!.offerId,
  };
}

export function offerLabel(offer: VariantOffer): string {
  if (offer.displayText) return offer.displayText;
  const base =
    offer.kind === "percentage"
      ? `خصم ${offer.value}٪`
      : offer.kind === "amount_off"
        ? `وفّر ${(offer.value / 100).toFixed(offer.value % 100 ? 2 : 0)} ₪`
        : "سعر العرض";
  return offer.minQuantity > 1
    ? `${base} عند شراء ${offer.minQuantity} أو أكثر`
    : base;
}

// Two offers whose dates overlap may not price the same variant.
export function windowsOverlap(
  left: { startsAt: Date | null; endsAt: Date | null },
  right: { startsAt: Date | null; endsAt: Date | null },
): boolean {
  const leftStart = left.startsAt?.getTime() ?? -Infinity;
  const leftEnd = left.endsAt?.getTime() ?? Infinity;
  const rightStart = right.startsAt?.getTime() ?? -Infinity;
  const rightEnd = right.endsAt?.getTime() ?? Infinity;
  return leftStart < rightEnd && rightStart < leftEnd;
}

export function isOfferLive(
  offer: {
    enabled: boolean;
    archivedAt: Date | null;
    startsAt: Date | null;
    endsAt: Date | null;
  },
  now: Date,
): boolean {
  return (
    offer.enabled &&
    !offer.archivedAt &&
    (!offer.startsAt || offer.startsAt <= now) &&
    (!offer.endsAt || offer.endsAt > now)
  );
}
