"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import {
  cartMerchandiseSubtotal,
  removedCartLines,
  resolveCartLines,
} from "@/features/cart/cart-lines";
import { cartLineKey } from "@/features/cart/cart-store";
import { useCart } from "@/features/cart/cart-provider";
import {
  localizedProductName,
  type Product,
} from "@/features/catalog/domain/product";
import { formatVariantAttributes } from "@/features/catalog/domain/product-variant";
import { sellingLineText } from "@/features/catalog/domain/selling-unit";
import { ACTIVE_SERVICE_AREA_CODE } from "@/features/delivery/delivery-policy";
import { calculateDeliveryFeeAgorot } from "@/features/delivery/delivery-policy";
import { getFreeDeliveryMessage } from "@/features/delivery/delivery-messaging";
import type { ServiceArea } from "@/features/delivery/service-area";
import { orderApiResponseSchema } from "@/features/orders/domain/order-confirmation";
import { WHATSAPP_COUNTRY_CODES } from "@/features/orders/domain/phone";
import type { CheckoutChannel } from "@/features/orders/domain/whatsapp-order";
import { LOCALE_HEADER, localizePath } from "@/i18n/config";
import { useI18n } from "@/i18n/i18n-provider";
import { Link } from "@/i18n/link";
import { formatIls } from "@/shared/lib/format-currency";

export interface CheckoutPrefill {
  customerName: string;
  countryCode: "970" | "972";
  nationalNumber: string;
}

export function CheckoutForm({
  products,
  serviceAreas,
  prefill = null,
  signInHint = false,
  channel = "web",
}: {
  products: readonly Product[];
  serviceAreas: readonly ServiceArea[];
  prefill?: CheckoutPrefill | null;
  signInHint?: boolean;
  channel?: CheckoutChannel;
}) {
  const router = useRouter();
  const { m: messages, locale } = useI18n();
  const m = messages.checkout;
  const cartText = messages.cart;
  const { lines, ready, clearCart } = useCart();
  // One key per way of sending, so trying the other channel after a failure is a new attempt.
  const [idempotencyKeys] = useState(() => ({
    web: crypto.randomUUID(),
    whatsapp: crypto.randomUUID(),
  }));
  const [submitting, setSubmitting] = useState(false);
  const [generalError, setGeneralError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<
    Record<string, string[] | undefined>
  >({});
  const errorSummaryRef = useRef<HTMLDivElement>(null);

  const productsById = useMemo(
    () => new Map(products.map((product) => [product.id, product])),
    [products],
  );
  const resolvedLines = resolveCartLines(lines, productsById);
  const hasUnavailableProduct =
    resolvedLines.some(
      (line) => line.status === "unavailable" || line.status === "limited",
    ) || removedCartLines(lines, productsById).length > 0;
  const needsUnitReview = resolvedLines.some(
    (line) => line.status === "review",
  );
  const merchandiseSubtotal = cartMerchandiseSubtotal(resolvedLines);
  const deliveryFeeAgorot = calculateDeliveryFeeAgorot(merchandiseSubtotal);
  const orderTotal = merchandiseSubtotal + deliveryFeeAgorot;
  const freeDeliveryMessage = getFreeDeliveryMessage(
    merchandiseSubtotal,
    locale,
  );
  const freeDeliveryQualified =
    deliveryFeeAgorot === 0 && merchandiseSubtotal > 0;
  const maythalunEnabled = serviceAreas.some(
    (area) => area.code === ACTIVE_SERVICE_AREA_CODE && area.enabled,
  );
  const canSubmit =
    ready &&
    resolvedLines.length > 0 &&
    resolvedLines.length === lines.length &&
    !hasUnavailableProduct &&
    !needsUnitReview &&
    maythalunEnabled;

  // Focus after the summary has rendered; a counter refocuses even when the message repeats.
  const [errorFocus, setErrorFocus] = useState(0);
  useEffect(() => {
    if (errorFocus) errorSummaryRef.current?.focus();
  }, [errorFocus]);
  const focusErrorSummary = () => setErrorFocus((count) => count + 1);

  async function submitOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setGeneralError("");
    setFieldErrors({});

    if (!canSubmit) {
      setGeneralError(
        !maythalunEnabled ? m.deliveryOnlyMaythalun : m.reviewCartFirst,
      );
      focusErrorSummary();
      return;
    }

    const form = new FormData(event.currentTarget);
    const checkoutChannel = channel;
    const requestBody = {
      idempotencyKey: idempotencyKeys[checkoutChannel],
      checkoutChannel,
      customerName: form.get("customerName"),
      whatsappCountryCode: form.get("whatsappCountryCode"),
      whatsappNationalNumber: form.get("whatsappNationalNumber"),
      serviceAreaCode: ACTIVE_SERVICE_AREA_CODE,
      paymentMethod: "cash_on_delivery",
      honeypot: form.get("companyWebsite"),
      // Only identifiers and counts go to the server; it prices and checks stock itself.
      items: resolvedLines.map(({ line }) => ({
        productId: line.productId,
        variantId: line.variantId,
        sellingUnitId: line.sellingUnitId,
        unitsPerSale: line.unitsPerSale,
        quantity: line.quantity,
      })),
    };

    setSubmitting(true);
    try {
      const response = await fetch("/api/orders", {
        method: "POST",
        // The proxy doesn't run on /api, so the language travels with the request.
        headers: {
          "Content-Type": "application/json",
          [LOCALE_HEADER]: locale,
        },
        body: JSON.stringify(requestBody),
      });
      const parsed = orderApiResponseSchema.safeParse(await response.json());
      if (!parsed.success) {
        setGeneralError(m.unreadableResult);
        focusErrorSummary();
        return;
      }
      if (!parsed.data.ok) {
        setGeneralError(parsed.data.message);
        setFieldErrors(parsed.data.fieldErrors ?? {});
        focusErrorSummary();
        return;
      }

      clearCart();
      const confirmation = `/orders/${parsed.data.confirmation.publicReference}/confirmation`;
      // The WhatsApp hand-off happens on the confirmation page, in this same tab.
      router.push(
        localizePath(
          locale,
          checkoutChannel === "whatsapp"
            ? `${confirmation}?handoff=1`
            : confirmation,
        ),
      );
    } catch {
      setGeneralError(m.connectionFailed);
      focusErrorSummary();
    } finally {
      setSubmitting(false);
    }
  }

  if (!ready) {
    return (
      <div className="checkout-loading" role="status">
        {m.loading}
      </div>
    );
  }

  const whatsappDescribedBy = [
    "whatsapp-help",
    fieldErrors.whatsappCountryCode || fieldErrors.whatsappNationalNumber
      ? "whatsapp-error"
      : null,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <form className="checkout-layout" onSubmit={submitOrder} noValidate>
      <div className="checkout-fields">
        <div>
          <span className="eyebrow">{m.eyebrow}</span>
          <h1>{m.title}</h1>
          {prefill ? (
            <p className="checkout-field-help">{m.prefilled}</p>
          ) : signInHint ? (
            <p className="checkout-field-help">
              {m.signInBefore}
              <Link href="/account?next=/checkout">{m.signIn}</Link>
              {m.signInAfter}
            </p>
          ) : null}
        </div>

        {generalError ? (
          <div
            ref={errorSummaryRef}
            className="checkout-error-summary"
            role="alert"
            tabIndex={-1}
          >
            <h2>{m.errorTitle}</h2>
            <p>{generalError}</p>
          </div>
        ) : null}

        {/* The error sits outside the label so it never becomes part of the field's name. */}
        <div className="checkout-field">
          <label htmlFor="checkout-customer-name">{m.name}</label>
          <input
            id="checkout-customer-name"
            name="customerName"
            type="text"
            defaultValue={prefill?.customerName}
            autoComplete="name"
            maxLength={100}
            aria-invalid={Boolean(fieldErrors.customerName)}
            aria-describedby={
              fieldErrors.customerName ? "customer-name-error" : undefined
            }
          />
          {fieldErrors.customerName ? (
            <small id="customer-name-error">
              {fieldErrors.customerName[0]}
            </small>
          ) : null}
        </div>

        <fieldset className="checkout-field checkout-whatsapp-field">
          <legend>{m.whatsappLegend}</legend>
          <div className="checkout-whatsapp-row">
            <label className="checkout-whatsapp-prefix">
              <span className="sr-only">{m.countryCode}</span>
              <select
                name="whatsappCountryCode"
                defaultValue={prefill?.countryCode ?? "970"}
                aria-invalid={Boolean(fieldErrors.whatsappCountryCode)}
                aria-describedby={whatsappDescribedBy}
              >
                {WHATSAPP_COUNTRY_CODES.map((code) => (
                  <option key={code} value={code}>
                    {m.prefixLabels[code]}
                  </option>
                ))}
              </select>
            </label>
            <label className="checkout-whatsapp-national">
              <span className="sr-only">{m.localNumber}</span>
              <input
                name="whatsappNationalNumber"
                type="tel"
                defaultValue={prefill?.nationalNumber}
                autoComplete="tel"
                inputMode="tel"
                maxLength={24}
                placeholder="05XXXXXXXX"
                aria-invalid={Boolean(fieldErrors.whatsappNationalNumber)}
                aria-describedby={whatsappDescribedBy}
              />
            </label>
          </div>
          <small id="whatsapp-help" className="checkout-field-help">
            {m.whatsappHelp}
          </small>
          {fieldErrors.whatsappCountryCode ||
          fieldErrors.whatsappNationalNumber ? (
            <small id="whatsapp-error">
              {fieldErrors.whatsappNationalNumber?.[0] ??
                fieldErrors.whatsappCountryCode?.[0]}
            </small>
          ) : null}
        </fieldset>

        <label className="checkout-honeypot" aria-hidden="true">
          <span>{m.honeypot}</span>
          <input
            name="companyWebsite"
            type="text"
            tabIndex={-1}
            autoComplete="off"
          />
        </label>

        <p className="checkout-contact-note">{m.contactNote}</p>

        <section className="payment-method" aria-labelledby="payment-title">
          <h2 id="payment-title">{m.paymentTitle}</h2>
          <p>{m.paymentText}</p>
        </section>
      </div>

      <aside className="checkout-summary" aria-labelledby="summary-title">
        <h2 id="summary-title">{cartText.summaryTitle}</h2>
        <p className="checkout-service-note">{m.serviceNote}</p>
        {!resolvedLines.length ? (
          <p className="checkout-blocker">{m.cartEmpty}</p>
        ) : null}
        {hasUnavailableProduct ? (
          <p className="checkout-blocker">{m.unavailableProduct}</p>
        ) : null}
        {needsUnitReview ? (
          <p className="checkout-blocker">{m.unitReview}</p>
        ) : null}
        {!maythalunEnabled ? (
          <p className="checkout-blocker">{m.deliveryOnlyMaythalun}</p>
        ) : null}

        <div className="checkout-items">
          {resolvedLines.map((resolved) => {
            const { line, unit } = resolved;
            const attributeSummary = formatVariantAttributes(
              resolved.variant.attributes,
            );
            const showUnit = Boolean(
              unit &&
              (unit.unitsPerSale > 1 ||
                resolved.variant.sellingUnits.length > 1),
            );
            return (
              <div key={cartLineKey(line)}>
                <span>
                  <bdi dir="auto">
                    {localizedProductName(resolved.product, locale)}
                  </bdi>
                  {unit && showUnit ? (
                    <>
                      {" · "}
                      <bdi dir="auto">
                        {sellingLineText(unit.labelAr, line.quantity)}
                      </bdi>
                    </>
                  ) : (
                    <>
                      {" × "}
                      {line.quantity}
                    </>
                  )}
                  <span className="checkout-item-variant">
                    {" · "}
                    {resolved.variant.labelAr}
                    {attributeSummary ? ` · ${attributeSummary}` : ""}
                  </span>
                </span>
                <bdi dir="ltr">
                  {resolved.lineSubtotalAgorot === null
                    ? "—"
                    : formatIls(resolved.lineSubtotalAgorot)}
                </bdi>
              </div>
            );
          })}
        </div>

        <div className="checkout-summary-rows">
          <div className="checkout-total">
            <span>{cartText.subtotal}</span>
            <strong>
              <bdi dir="ltr">{formatIls(merchandiseSubtotal)}</bdi>
            </strong>
          </div>
          <div className="checkout-delivery">
            <span>{cartText.delivery}</span>
            <strong>
              <bdi dir="ltr">{formatIls(deliveryFeeAgorot)}</bdi>
            </strong>
          </div>
          <div className="checkout-total">
            <span>{cartText.total}</span>
            <strong>
              <bdi dir="ltr">{formatIls(orderTotal)}</bdi>
            </strong>
          </div>
        </div>
        {merchandiseSubtotal > 0 ? (
          <p
            className="free-delivery-hint"
            data-qualified={freeDeliveryQualified}
            role="status"
          >
            {freeDeliveryMessage}
          </p>
        ) : null}
        <button
          type="submit"
          className={channel === "whatsapp" ? "checkout-whatsapp" : undefined}
          disabled={!canSubmit || submitting}
        >
          {submitting
            ? m.submitting
            : channel === "whatsapp"
              ? m.submitWhatsApp
              : m.submitWeb}
        </button>
        <p className="checkout-privacy">{m.privacy}</p>
      </aside>
    </form>
  );
}
