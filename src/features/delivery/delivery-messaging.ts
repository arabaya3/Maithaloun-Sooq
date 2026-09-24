import {
  amountUntilFreeDeliveryAgorot,
  FREE_DELIVERY_THRESHOLD_AGOROT,
} from "@/features/delivery/delivery-policy";
import { formatIls } from "@/shared/lib/format-currency";

export const FREE_DELIVERY_BANNER =
  "توصيل مجاني للطلبات بقيمة 50 ₪ أو أكثر" as const;

export function getFreeDeliveryMessage(subtotalAgorot: number): string {
  const remaining = amountUntilFreeDeliveryAgorot(subtotalAgorot);
  if (remaining === 0) {
    return "مبروك، حصلت على توصيل مجاني";
  }
  return `أضف ${formatIls(remaining)} لتحصل على توصيل مجاني`;
}

export function getFreeDeliveryThresholdLabel(): string {
  return formatIls(FREE_DELIVERY_THRESHOLD_AGOROT);
}
