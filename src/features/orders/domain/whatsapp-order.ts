import { formatIls } from "@/shared/lib/format-currency";

import { isSupportedWhatsAppE164 } from "./phone";

export const STORE_WHATSAPP_KEY = "store_whatsapp_e164";
export const checkoutChannels = ["web", "whatsapp"] as const;
export type CheckoutChannel = (typeof checkoutChannels)[number];

export interface WhatsAppOrderLine {
  name: string;
  options: string | null;
  unit: string | null;
  quantity: number;
  lineSubtotalAgorot: number;
}

/**
 * The message the customer sends from their own WhatsApp. It names the order and its lines only:
 * the confirmation page is reachable by reference, so no name, phone or address goes into it.
 */
export function whatsAppOrderMessage(order: {
  publicReference: string;
  lines: readonly WhatsAppOrderLine[];
  itemsSubtotalAgorot: number;
  deliveryFeeAgorot: number | null;
  finalTotalAgorot: number | null;
}): string {
  const lines = order.lines.map((line) => {
    const detail = [line.options, line.unit].filter(Boolean).join(" · ");
    return `• ${line.name}${detail ? ` (${detail})` : ""} × ${line.quantity} = ${formatIls(line.lineSubtotalAgorot)}`;
  });
  return [
    `مرحباً، أريد تأكيد طلبي رقم ${order.publicReference}`,
    ...lines,
    `مجموع المنتجات: ${formatIls(order.itemsSubtotalAgorot)}`,
    order.deliveryFeeAgorot === null
      ? "التوصيل: يُؤكَّد لاحقاً"
      : `التوصيل: ${formatIls(order.deliveryFeeAgorot)}`,
    ...(order.finalTotalAgorot === null
      ? []
      : [`الإجمالي: ${formatIls(order.finalTotalAgorot)}`]),
    "الدفع نقداً عند الاستلام.",
  ].join("\n");
}

export function whatsAppLinks(
  storeE164: string,
  message: string,
): { app: string; web: string } | null {
  if (!isSupportedWhatsAppE164(storeE164)) return null;
  const phone = storeE164.slice(1);
  const text = encodeURIComponent(message);
  return {
    app: `https://wa.me/${phone}?text=${text}`,
    web: `https://web.whatsapp.com/send?phone=${phone}&text=${text}`,
  };
}
