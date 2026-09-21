import { z } from "zod";

import { serviceAreaCodeSchema, type ServiceArea } from "./service-area";

export const deliveryLocationIdSchema = serviceAreaCodeSchema;

export type DeliveryLocationId = z.infer<typeof deliveryLocationIdSchema>;
export type DeliveryLocationOption = Pick<ServiceArea, "code" | "nameAr">;

export function getDeliveryLocationLabel(
  locationId: DeliveryLocationId | null,
  locations: readonly DeliveryLocationOption[],
): string {
  if (!locationId) return "غير محدد";
  return (
    locations.find((location) => location.code === locationId)?.nameAr ??
    "غير محدد"
  );
}
