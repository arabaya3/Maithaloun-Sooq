import type { OfferKind } from "@/features/catalog/domain/offer-pricing";

export const offerStatuses = [
  "active",
  "upcoming",
  "draft",
  "expired",
  "archived",
] as const;
export type OfferStatus = (typeof offerStatuses)[number];

export const offerStatusLabels: Record<OfferStatus, string> = {
  active: "فعّال الآن",
  upcoming: "يبدأ لاحقاً",
  draft: "غير مفعّل",
  expired: "منتهٍ",
  archived: "مؤرشف",
};

/**
 * Where an offer stands right now. An expired window wins over the enabled switch, so an offer that
 * ran out is never listed as a draft waiting to be switched on.
 */
export function offerStatus(
  offer: {
    enabled: boolean;
    archived: boolean;
    startsAt: string | null;
    endsAt: string | null;
  },
  now: Date,
): OfferStatus {
  if (offer.archived) return "archived";
  if (offer.endsAt && Date.parse(offer.endsAt) <= now.getTime())
    return "expired";
  if (!offer.enabled) return "draft";
  if (offer.startsAt && Date.parse(offer.startsAt) > now.getTime())
    return "upcoming";
  return "active";
}

export const offerKindLabels: Record<OfferKind, string> = {
  percentage: "نسبة خصم",
  amount_off: "خصم مبلغ",
  fixed_price: "سعر ثابت",
};

/** The offer's rule in words, with money in shekels. */
export function describeOfferValue(offer: {
  kind: OfferKind;
  value: number;
  minQuantity: number;
}): string {
  const shekels = (agorot: number) =>
    `${(agorot / 100).toFixed(agorot % 100 ? 2 : 0)} ₪`;
  const base =
    offer.kind === "percentage"
      ? `خصم ${offer.value}٪`
      : offer.kind === "amount_off"
        ? `خصم ${shekels(offer.value)} للقطعة`
        : `بسعر ${shekels(offer.value)} للقطعة`;
  return offer.minQuantity > 1
    ? `${base} عند شراء ${offer.minQuantity} أو أكثر`
    : base;
}
