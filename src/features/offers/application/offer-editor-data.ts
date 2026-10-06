import "server-only";

import {
  adminCatalogService,
  catalogAuthoringService,
} from "@/features/admin/application/admin-services";
import type { AdminActor } from "@/features/admin/domain/admin-actor";
import type { OfferEditorValues } from "@/features/offers/ui/offer-editor";
import { addDays, startOfStoreDay, toStoreDate } from "@/shared/lib/store-time";

import type { OfferSummary } from "./offer-service";

/** Categories and products the owner can target, read from the catalogue services. */
export async function offerTargetChoices(actor: AdminActor) {
  const [categories, products] = await Promise.all([
    catalogAuthoringService.listCategories(),
    adminCatalogService.list(actor),
  ]);
  return {
    categories: categories.map(({ code, nameAr }) => ({ code, nameAr })),
    products: products.map(({ id, nameAr, categoryId }) => ({
      id,
      nameAr,
      categoryId,
    })),
  };
}

export const emptyOfferValues: OfferEditorValues = {
  id: null,
  version: null,
  nameAr: "",
  displayText: "",
  kind: "percentage",
  value: "",
  minQuantity: 1,
  startDate: "",
  endDate: "",
  enabled: false,
  roundsTimes: false,
  productIds: [],
  variantIds: [],
  categoryCodes: [],
};

const atDayStart = (iso: string) =>
  startOfStoreDay(toStoreDate(new Date(iso))).toISOString() ===
  new Date(iso).toISOString();

export function offerValues(offer: OfferSummary): OfferEditorValues {
  const endsAtMidnight = !offer.endsAt || atDayStart(offer.endsAt);
  return {
    id: offer.id,
    version: offer.updatedAt,
    nameAr: offer.nameAr,
    displayText: offer.displayText ?? "",
    kind: offer.kind,
    value:
      offer.kind === "percentage"
        ? String(offer.value)
        : (offer.value / 100).toFixed(offer.value % 100 ? 2 : 0),
    minQuantity: offer.minQuantity,
    startDate: offer.startsAt ? toStoreDate(new Date(offer.startsAt)) : "",
    // Stored as the start of the day after the last day, so the editor shows the last day itself.
    endDate: offer.endsAt
      ? endsAtMidnight
        ? addDays(toStoreDate(new Date(offer.endsAt)), -1)
        : toStoreDate(new Date(offer.endsAt))
      : "",
    roundsTimes:
      !endsAtMidnight || Boolean(offer.startsAt && !atDayStart(offer.startsAt)),
    enabled: offer.enabled,
    productIds: offer.targets.productIds,
    variantIds: offer.targets.variantIds,
    categoryCodes: offer.targets.categoryCodes,
  };
}
