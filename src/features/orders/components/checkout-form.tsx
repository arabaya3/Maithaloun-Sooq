"use client";

import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, type FormEvent } from "react";

import {
  calculateCartSubtotal,
  calculateLineSubtotal,
} from "@/features/cart/cart-store";
import { useCart } from "@/features/cart/cart-provider";
import {
  getProductDisplayName,
  isProductAvailable,
  type Product,
} from "@/features/catalog/domain/product";
import { useDelivery } from "@/features/delivery/delivery-provider";
import type { ServiceArea } from "@/features/delivery/service-area";
import { orderApiResponseSchema } from "@/features/orders/domain/order-confirmation";
import { WHATSAPP_COUNTRY_CODES } from "@/features/orders/domain/phone";
import { formatIls } from "@/shared/lib/format-currency";

const WHATSAPP_PREFIX_LABELS: Record<
  (typeof WHATSAPP_COUNTRY_CODES)[number],
  string
> = {
  "970": "فلسطين +970",
  "972": "فلسطين/الداخل +972",
};

export function CheckoutForm({
  products,
  serviceAreas,
}: {
  products: readonly Product[];
  serviceAreas: readonly ServiceArea[];
}) {
  const router = useRouter();
  const { lines, ready, clearCart } = useCart();
  const { locationId } = useDelivery();
  const [idempotencyKey] = useState(() => crypto.randomUUID());
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
  const resolvedLines = lines.flatMap((line) => {
    const product = productsById.get(line.productId);
    return product ? [{ ...line, product }] : [];
  });
  const hasUnavailableProduct = resolvedLines.some(
    (line) => !isProductAvailable(line.product),
  );
  const subtotal = calculateCartSubtotal(
    resolvedLines
      .filter((line) => isProductAvailable(line.product))
      .map((line) => ({
        unitPriceAgorot: line.product.priceAgorot,
        quantity: line.quantity,
      })),
  );
  const selectedArea =
    serviceAreas.find((area) => area.code === locationId) ?? null;
  const canSubmit =
    ready &&
    resolvedLines.length > 0 &&
    resolvedLines.length === lines.length &&
    !hasUnavailableProduct &&
    Boolean(selectedArea);

  const focusErrorSummary = () => {
    queueMicrotask(() => errorSummaryRef.current?.focus());
  };

  async function submitOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setGeneralError("");
    setFieldErrors({});

    if (!canSubmit || !locationId) {
      setGeneralError(
        !locationId
          ? "اختر منطقة التوصيل قبل إرسال الطلب."
          : "راجع السلة قبل إرسال الطلب.",
      );
      focusErrorSummary();
      return;
    }

    const form = new FormData(event.currentTarget);
    const requestBody = {
      idempotencyKey,
      customerName: form.get("customerName"),
      whatsappCountryCode: form.get("whatsappCountryCode"),
      whatsappNationalNumber: form.get("whatsappNationalNumber"),
      serviceAreaCode: locationId,
      deliveryAddress: form.get("deliveryAddress"),
      customerNote: form.get("customerNote"),
      paymentMethod: "cash_on_delivery",
      honeypot: form.get("companyWebsite"),
      items: lines,
    };

    setSubmitting(true);
    try {
      const response = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });
      const parsed = orderApiResponseSchema.safeParse(await response.json());
      if (!parsed.success) {
        setGeneralError("تعذّر قراءة نتيجة الطلب. لم تُمسح السلة.");
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
      router.push(
        `/orders/${parsed.data.confirmation.publicReference}/confirmation`,
      );
    } catch {
      setGeneralError("تعذّر الاتصال بالخادم. لم تُمسح السلة.");
      focusErrorSummary();
    } finally {
      setSubmitting(false);
    }
  }

  if (!ready) {
    return (
      <div className="checkout-loading" role="status">
        جارٍ تحميل بيانات السلة…
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
          <span className="eyebrow">الدفع عند الاستلام</span>
          <h1>بيانات الطلب</h1>
        </div>

        {generalError ? (
          <div
            ref={errorSummaryRef}
            className="checkout-error-summary"
            role="alert"
            tabIndex={-1}
          >
            <h2>تعذّر إرسال الطلب</h2>
            <p>{generalError}</p>
          </div>
        ) : null}

        <label className="checkout-field">
          <span>الاسم الكامل</span>
          <input
            name="customerName"
            type="text"
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
        </label>

        <fieldset className="checkout-field checkout-whatsapp-field">
          <legend>رقم الواتساب</legend>
          <div className="checkout-whatsapp-row">
            <label className="checkout-whatsapp-prefix">
              <span className="sr-only">مفتاح الدولة</span>
              <select
                name="whatsappCountryCode"
                defaultValue="970"
                aria-invalid={Boolean(fieldErrors.whatsappCountryCode)}
                aria-describedby={whatsappDescribedBy}
              >
                {WHATSAPP_COUNTRY_CODES.map((code) => (
                  <option key={code} value={code}>
                    {WHATSAPP_PREFIX_LABELS[code]}
                  </option>
                ))}
              </select>
            </label>
            <label className="checkout-whatsapp-national">
              <span className="sr-only">الرقم المحلي</span>
              <input
                name="whatsappNationalNumber"
                type="tel"
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
            يُستخدم رقم الواتساب فقط لتأكيد الطلب وتنفيذ التوصيل.
          </small>
          {fieldErrors.whatsappCountryCode ||
          fieldErrors.whatsappNationalNumber ? (
            <small id="whatsapp-error">
              {fieldErrors.whatsappNationalNumber?.[0] ??
                fieldErrors.whatsappCountryCode?.[0]}
            </small>
          ) : null}
        </fieldset>

        <div className="checkout-field">
          <label htmlFor="delivery-address-input">
            العنوان بالتفصيل أو أقرب نقطة دالة
          </label>
          <textarea
            id="delivery-address-input"
            name="deliveryAddress"
            autoComplete="street-address"
            maxLength={500}
            rows={4}
            aria-invalid={Boolean(fieldErrors.deliveryAddress)}
            aria-describedby={
              fieldErrors.deliveryAddress
                ? "delivery-address-help delivery-address-error"
                : "delivery-address-help"
            }
          />
          <small id="delivery-address-help" className="checkout-field-help">
            يمكنك كتابة الشارع أو الحي أو المبنى أو أقرب نقطة دالة معروفة.
          </small>
          {fieldErrors.deliveryAddress ? (
            <small id="delivery-address-error">
              {fieldErrors.deliveryAddress[0]}
            </small>
          ) : null}
        </div>

        <label className="checkout-field">
          <span>
            ملاحظات الطلب <small>اختياري</small>
          </span>
          <textarea name="customerNote" maxLength={500} rows={3} />
        </label>

        <label className="checkout-honeypot" aria-hidden="true">
          <span>موقع الشركة</span>
          <input
            name="companyWebsite"
            type="text"
            tabIndex={-1}
            autoComplete="off"
          />
        </label>

        <section className="payment-method" aria-labelledby="payment-title">
          <h2 id="payment-title">طريقة الدفع</h2>
          <p>الدفع نقداً عند الاستلام</p>
        </section>
      </div>

      <aside className="checkout-summary" aria-labelledby="summary-title">
        <h2 id="summary-title">ملخص الطلب</h2>
        {!resolvedLines.length ? (
          <p className="checkout-blocker">السلة فارغة. أضف منتجات أولاً.</p>
        ) : null}
        {hasUnavailableProduct ? (
          <p className="checkout-blocker">
            تحتوي السلة على منتج غير متاح حالياً.
          </p>
        ) : null}
        {!selectedArea ? (
          <p className="checkout-blocker">اختر منطقة التوصيل من أعلى الصفحة.</p>
        ) : null}

        <div className="checkout-items">
          {resolvedLines.map((line) => (
            <div key={line.product.id}>
              <span>
                <bdi dir="auto">{getProductDisplayName(line.product)}</bdi>
                {" × "}
                {line.quantity}
              </span>
              <bdi dir="ltr">
                {formatIls(
                  calculateLineSubtotal(
                    line.product.priceAgorot,
                    line.quantity,
                  ),
                )}
              </bdi>
            </div>
          ))}
        </div>

        <div className="checkout-total">
          <span>مجموع المنتجات</span>
          <strong>
            <bdi dir="ltr">{formatIls(subtotal)}</bdi>
          </strong>
        </div>
        <div className="checkout-delivery">
          <span>منطقة التوصيل</span>
          <strong>{selectedArea?.nameAr ?? "غير محدد"}</strong>
        </div>
        <p className="delivery-pending">
          {selectedArea?.deliveryFeeAgorot == null
            ? "سيتم تأكيد تكلفة التوصيل لاحقاً."
            : `تكلفة التوصيل: ${formatIls(selectedArea.deliveryFeeAgorot)}`}
        </p>
        <button type="submit" disabled={!canSubmit || submitting}>
          {submitting ? "جارٍ إرسال الطلب…" : "تأكيد الطلب"}
        </button>
        <p className="checkout-privacy">
          تُستخدم هذه البيانات لتنفيذ هذا الطلب فقط.
        </p>
      </aside>
    </form>
  );
}
