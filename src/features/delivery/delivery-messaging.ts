import {
  amountUntilFreeDeliveryAgorot,
  FREE_DELIVERY_THRESHOLD_AGOROT,
} from "@/features/delivery/delivery-policy";
import type { Locale } from "@/i18n/config";
import { messagesFor } from "@/i18n/messages";
import { formatIls } from "@/shared/lib/format-currency";

export const FREE_DELIVERY_BANNER = `توصيل مجاني للطلبات بقيمة ${formatIls(FREE_DELIVERY_THRESHOLD_AGOROT)} أو أكثر`;

export function getFreeDeliveryBanner(locale: Locale = "ar"): string {
  return messagesFor(locale).cart.freeDeliveryBanner;
}

export function getFreeDeliveryMessage(
  subtotalAgorot: number,
  locale: Locale = "ar",
): string {
  const m = messagesFor(locale).cart;
  const remaining = amountUntilFreeDeliveryAgorot(subtotalAgorot);
  if (remaining === 0) {
    return m.freeDeliveryReached;
  }
  return m.freeDeliveryRemaining(formatIls(remaining));
}

export function getFreeDeliveryThresholdLabel(): string {
  return formatIls(FREE_DELIVERY_THRESHOLD_AGOROT);
}
