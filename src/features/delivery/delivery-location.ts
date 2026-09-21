import { z } from "zod";

export const deliveryLocations = [
  { id: "ramallah", label: "رام الله" },
  { id: "al-bireh", label: "البيرة" },
  { id: "maythalun", label: "ميثلون" },
  { id: "other", label: "منطقة أخرى" },
] as const;

export const deliveryLocationIdSchema = z.enum([
  "ramallah",
  "al-bireh",
  "maythalun",
  "other",
]);

export type DeliveryLocationId = z.infer<typeof deliveryLocationIdSchema>;

export function getDeliveryLocationLabel(
  locationId: DeliveryLocationId | null,
): string {
  if (!locationId) return "غير محدد";
  return (
    deliveryLocations.find((location) => location.id === locationId)?.label ??
    "غير محدد"
  );
}
