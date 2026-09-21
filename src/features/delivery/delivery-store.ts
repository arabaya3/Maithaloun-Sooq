import { z } from "zod";

import {
  deliveryLocationIdSchema,
  type DeliveryLocationId,
} from "./delivery-location";

export const DELIVERY_STORAGE_KEY = "souq-maythalun:delivery:v1";

const persistedDeliverySchema = z
  .object({
    version: z.literal(1),
    locationId: deliveryLocationIdSchema,
  })
  .strict();

export function parsePersistedDeliveryLocation(
  raw: string | null,
): DeliveryLocationId | null {
  if (!raw) return null;

  try {
    const parsed = persistedDeliverySchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data.locationId : null;
  } catch {
    return null;
  }
}

export function serializeDeliveryLocation(
  locationId: DeliveryLocationId,
): string {
  return JSON.stringify({ version: 1, locationId });
}
