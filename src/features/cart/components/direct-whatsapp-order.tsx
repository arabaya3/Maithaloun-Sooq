"use client";

import { MessageCircle } from "lucide-react";
import { useRef, useState } from "react";

import type { CartLine } from "@/features/cart/cart-store";
import {
  whatsAppCartMessage,
  whatsAppLinks,
  type WhatsAppCartQuote,
} from "@/features/orders/domain/whatsapp-order";
import { useI18n } from "@/i18n/i18n-provider";

type QuoteResponse =
  { ok: true; quote: WhatsAppCartQuote } | { ok: false; error: string };

/**
 * Prices the cart on the server, then opens the store's WhatsApp chat with the order written out.
 * No form, no order and no stock reservation: the customer sends it and the store confirms in the chat.
 */
export function DirectWhatsAppOrder({
  lines,
  storeWhatsApp,
}: {
  lines: readonly CartLine[];
  storeWhatsApp: string;
}) {
  const { m, locale, href } = useI18n();
  const [state, setState] = useState<"idle" | "pricing" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const pricing = useRef(false);

  async function open() {
    // A second tap before the button re-renders disabled must not price or open twice.
    if (pricing.current) return;
    pricing.current = true;
    setState("pricing");
    setError(null);
    try {
      const response = await fetch(`/api/v1/cart/quote?locale=${locale}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          items: lines.map((line) => ({
            productId: line.productId,
            variantId: line.variantId,
            sellingUnitId: line.sellingUnitId ?? null,
            unitsPerSale: line.unitsPerSale,
            quantity: line.quantity,
          })),
        }),
      });
      const result = (await response.json()) as QuoteResponse;
      if (!result.ok) {
        setError(
          result.error === "insufficient_stock" ||
            result.error === "unavailable_product" ||
            result.error === "selling_unit_changed"
            ? m.cart.whatsAppCartChanged
            : m.cart.whatsAppFailed,
        );
        setState("error");
        return;
      }
      const message = whatsAppCartMessage(
        result.quote,
        locale,
        new URL(href("/"), window.location.origin).toString(),
      );
      const link = whatsAppLinks(storeWhatsApp, message);
      if (!link) throw new Error("unsupported store number");
      setState("idle");
      window.location.assign(link.app);
    } catch {
      setError(m.cart.whatsAppFailed);
      setState("error");
    } finally {
      pricing.current = false;
    }
  }

  return (
    <>
      <button
        type="button"
        className="checkout-action checkout-whatsapp-action"
        onClick={open}
        disabled={state === "pricing"}
        aria-describedby="cart-whatsapp-note"
      >
        <MessageCircle aria-hidden="true" />
        {state === "pricing"
          ? m.cart.whatsAppPreparing
          : m.cart.orderViaWhatsApp}
      </button>
      {error ? (
        <p className="checkout-blocker" role="alert">
          {error}
        </p>
      ) : null}
      <p id="cart-whatsapp-note" className="cart-channel-note">
        {m.cart.whatsAppNote}
      </p>
    </>
  );
}
