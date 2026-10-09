"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";

import { saveVariantCardAction } from "../application/product-wizard-actions";

export interface VariantCardData {
  id: string;
  label: string;
  priceAgorot: number;
  available: boolean;
  isDefault: boolean;
  sku: string | null;
  barcode: string | null;
  tracked: boolean;
  onHandPieces: number | null;
  thresholdPieces: number | null;
}

const ils = (agorot: number) => (agorot / 100).toFixed(2).replace(/\.00$/, "");

function VariantCard({
  productDomainId,
  variant,
  canStock,
}: {
  productDomainId: string;
  variant: VariantCardData;
  canStock: boolean;
}) {
  const router = useRouter();
  const uid = useId();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(
    null,
  );
  const [key, setKey] = useState(() => crypto.randomUUID());

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const text = (name: string) => String(data.get(name) ?? "");
    startTransition(async () => {
      const result = await saveVariantCardAction({
        productDomainId,
        variantId: variant.id,
        priceIls: text("price"),
        sku: text("sku"),
        barcode: text("barcode"),
        available: data.get("available") === "on",
        isDefault: data.get("default") === "on",
        stockPieces: canStock ? text("stock") : "",
        unitCostIls: canStock ? text("cost") : "",
        thresholdPieces: canStock ? text("threshold") : "",
        tracked: variant.tracked,
        idempotencyKey: key,
      });
      if (result.ok) {
        setKey(crypto.randomUUID());
        setMessage({ ok: true, text: "حُفظ هذا الصنف." });
        router.refresh();
      } else {
        setMessage({ ok: false, text: result.message });
      }
    });
  }

  const field = (name: string) => `${uid}-${name}`;
  return (
    <li className="admin-wizard-variant-card">
      <form onSubmit={submit} aria-labelledby={field("title")}>
        <h3 id={field("title")}>
          <bdi>{variant.label || "الصنف الأساسي"}</bdi>
          {variant.isDefault ? (
            <span className="admin-pill">الافتراضي</span>
          ) : null}
        </h3>
        <div className="admin-wizard-variant-card-grid">
          <label htmlFor={field("price")}>السعر (₪)</label>
          <input
            id={field("price")}
            name="price"
            inputMode="decimal"
            required
            defaultValue={ils(variant.priceAgorot)}
          />
          <label htmlFor={field("sku")}>رمز SKU</label>
          <input
            id={field("sku")}
            name="sku"
            dir="ltr"
            autoComplete="off"
            defaultValue={variant.sku ?? ""}
          />
          <label htmlFor={field("barcode")}>الباركود</label>
          <input
            id={field("barcode")}
            name="barcode"
            dir="ltr"
            inputMode="numeric"
            autoComplete="off"
            defaultValue={variant.barcode ?? ""}
          />
          {canStock ? (
            <>
              <label htmlFor={field("stock")}>
                {variant.tracked ? "الكمية المعدودة الآن" : "الكمية الافتتاحية"}
              </label>
              <input
                id={field("stock")}
                name="stock"
                inputMode="numeric"
                placeholder={
                  variant.onHandPieces === null
                    ? ""
                    : String(variant.onHandPieces)
                }
                aria-describedby={field("stock-hint")}
              />
              <p id={field("stock-hint")} className="admin-muted">
                {variant.tracked
                  ? `في المخزن ${variant.onHandPieces ?? 0} قطعة. اتركيه فارغًا إن لم يتغيّر.`
                  : "لهذا الصنف فقط؛ لا تُنسخ الكمية بين الأصناف."}
              </p>
              {variant.tracked ? null : (
                <>
                  <label htmlFor={field("cost")}>تكلفة القطعة (₪)</label>
                  <input id={field("cost")} name="cost" inputMode="decimal" />
                </>
              )}
              <label htmlFor={field("threshold")}>نبّهيني عند الوصول إلى</label>
              <input
                id={field("threshold")}
                name="threshold"
                inputMode="numeric"
                defaultValue={variant.thresholdPieces ?? ""}
              />
            </>
          ) : null}
        </div>
        <div className="admin-wizard-variant-card-toggles">
          <label>
            <input
              type="checkbox"
              name="available"
              defaultChecked={variant.available}
            />
            متوفر للبيع
          </label>
          <label>
            <input
              type="checkbox"
              name="default"
              defaultChecked={variant.isDefault}
              disabled={variant.isDefault}
            />
            الصنف الذي يظهر أولًا
          </label>
        </div>
        <button
          className="admin-button-primary"
          type="submit"
          disabled={pending}
        >
          {pending ? "جارٍ الحفظ…" : "حفظ الصنف"}
        </button>
        {message ? (
          <p
            className="admin-media-message"
            data-tone={message.ok ? "ok" : "error"}
            role={message.ok ? "status" : "alert"}
          >
            {message.text}
          </p>
        ) : null}
      </form>
    </li>
  );
}

export function VariantCards({
  productDomainId,
  variants,
  canStock,
}: {
  productDomainId: string;
  variants: VariantCardData[];
  canStock: boolean;
}) {
  return (
    <section
      id="wizard-prices"
      className="admin-wizard-variant-cards"
      aria-labelledby="variant-cards"
    >
      <h2 id="variant-cards" className="admin-workspace-section-title">
        سعر ومخزون كل صنف
      </h2>
      <ul>
        {variants.map((variant) => (
          <VariantCard
            key={variant.id}
            productDomainId={productDomainId}
            variant={variant}
            canStock={canStock}
          />
        ))}
      </ul>
    </section>
  );
}
