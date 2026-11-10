"use client";

import { MessageCircle } from "lucide-react";
import { useState } from "react";

import { whatsAppChatUrl } from "@/features/orders/domain/whatsapp-order";
import { useI18n } from "@/i18n/i18n-provider";

export function ProductRequestForm({ phone }: { phone: string | null }) {
  const { locale } = useI18n();
  const ar = locale === "ar";
  const [error, setError] = useState(false);
  const contact = phone ? whatsAppChatUrl(phone) : null;
  const productLabel = ar ? "اسم المنتج" : "Product name";
  const variantLabel = ar ? "الماركة أو الحجم" : "Brand or size";
  const notesLabel = ar ? "ملاحظات" : "Notes";
  const optional = ar ? "(اختياري)" : "(optional)";

  return (
    <main className="page-shell product-request-page">
      <h1>{ar ? "اطلب منتج غير متوفر" : "Request a product"}</h1>
      <p>
        {ar
          ? "مش لاقي المنتج؟ احكيلنا شو بدك وبنرد عليك."
          : "Can’t find a product? Tell us what you’re looking for."}
      </p>
      <form
        className="product-request-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!contact) return;
          const fields = new FormData(event.currentTarget);
          const name = String(fields.get("product") ?? "").trim();
          const variant = String(fields.get("variant") ?? "").trim();
          const notes = String(fields.get("notes") ?? "").trim();
          if (!name) {
            setError(true);
            event.currentTarget.querySelector("input")?.focus();
            return;
          }
          const message = [
            ar
              ? "مرحبًا ميثا، بدي أطلب منتج غير متوفر."
              : "Hi MAYTHA, I’d like to request a product.",
            `${productLabel}: ${name}`,
            variant ? `${variantLabel}: ${variant}` : "",
            notes ? `${notesLabel}: ${notes}` : "",
          ]
            .filter(Boolean)
            .join("\n");
          const url = new URL(contact);
          url.searchParams.set("text", message);
          window.location.assign(url.toString());
        }}
      >
        <label>
          <span>
            {productLabel} <span aria-hidden="true">*</span>
          </span>
          <input
            name="product"
            required
            maxLength={160}
            onChange={() => setError(false)}
            aria-invalid={error || undefined}
            aria-describedby={error ? "request-name-error" : undefined}
            placeholder={
              ar
                ? "مثال: شامبو هيد آند شولدرز"
                : "Example: Head & Shoulders shampoo"
            }
          />
          {error ? (
            <small id="request-name-error" role="alert">
              {ar ? "اكتب اسم المنتج." : "Enter a product name."}
            </small>
          ) : null}
        </label>
        <label>
          <span>
            {variantLabel} <small>{optional}</small>
          </span>
          <input name="variant" maxLength={160} />
        </label>
        <label>
          <span>
            {notesLabel} <small>{optional}</small>
          </span>
          <textarea name="notes" rows={2} maxLength={500} />
        </label>
        <button type="submit" className="add-button" disabled={!contact}>
          <MessageCircle aria-hidden="true" />
          {ar ? "إرسال عبر واتساب" : "Send via WhatsApp"}
        </button>
        <p>
          {contact
            ? ar
              ? "بنتأكد من التوفر والسعر وبنرد عليك."
              : "We’ll check availability and price and get back to you."
            : ar
              ? "واتساب غير متاح حاليًا."
              : "WhatsApp is currently unavailable."}
        </p>
      </form>
    </main>
  );
}
