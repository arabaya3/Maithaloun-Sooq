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
    "مرحباً MAYTHA MARKET،",
    `أريد تأكيد طلبي رقم ${order.publicReference}`,
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

/** A plain chat link to the store, for contact buttons; works on phones and desktop. */
export function whatsAppChatUrl(storeE164: string): string | null {
  if (!isSupportedWhatsAppE164(storeE164)) return null;
  return `https://wa.me/${storeE164.slice(1)}`;
}

export interface WhatsAppCartQuote {
  lines: readonly WhatsAppOrderLine[];
  itemsSubtotalAgorot: number;
  deliveryFeeAgorot: number;
  totalAgorot: number;
}

/**
 * The cart as a ready-to-send WhatsApp message, built only from the server quote.
 * Opening WhatsApp with it creates no order and reserves nothing; the store confirms in the chat.
 */
export function whatsAppCartMessage(
  quote: WhatsAppCartQuote,
  locale: "ar" | "en",
  storeUrl: string,
): string {
  const ar = locale === "ar";
  const lines = quote.lines.flatMap((line, index) => {
    const detail = [line.options, line.unit].filter(Boolean).join(" · ");
    return [
      `${index + 1}. ${line.name}`,
      ...(detail ? [`   ${ar ? "النوع" : "Option"}: ${detail}`] : []),
      `   ${ar ? "الكمية" : "Quantity"}: ${line.quantity}`,
      `   ${ar ? "السعر" : "Price"}: ${formatIls(line.lineSubtotalAgorot)}`,
    ];
  });
  return [
    ar ? "مرحباً MAYTHA MARKET 🌿" : "Hello MAYTHA MARKET 🌿",
    "",
    ar ? "بدي أطلب المنتجات التالية:" : "I'd like to order:",
    "",
    ...lines,
    "",
    `${ar ? "المجموع" : "Subtotal"}: ${formatIls(quote.itemsSubtotalAgorot)}`,
    `${ar ? "التوصيل" : "Delivery"}: ${formatIls(quote.deliveryFeeAgorot)}`,
    `${ar ? "الإجمالي" : "Total"}: ${formatIls(quote.totalAgorot)}`,
    ar ? "الدفع نقداً عند الاستلام." : "Cash on delivery.",
    "",
    `${ar ? "رابط المتجر" : "Store"}: ${storeUrl}`,
  ].join("\n");
}
