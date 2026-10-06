"use client";

import { startTransition, useActionState, useRef, useState } from "react";

import type { OfferKind } from "@/features/catalog/domain/offer-pricing";
import {
  previewOfferAction,
  saveOfferAction,
} from "@/features/offers/application/offer-actions";
import { offerKindLabels } from "@/features/offers/domain/offer-status";
import { formatIls } from "@/shared/lib/format-currency";

export interface OfferEditorValues {
  id: string | null;
  version: string | null;
  nameAr: string;
  displayText: string;
  kind: OfferKind;
  /** Percent for a percentage offer, shekels as typed for the others. */
  value: string;
  minQuantity: number;
  startDate: string;
  endDate: string;
  enabled: boolean;
  /** The saved window starts or ends mid-day; the editor works in whole days. */
  roundsTimes: boolean;
  productIds: string[];
  variantIds: string[];
  categoryCodes: string[];
}

const steps = [
  { id: "scope", label: "النطاق" },
  { id: "price", label: "السعر" },
  { id: "duration", label: "المدة" },
  { id: "preview", label: "المعاينة" },
] as const;

export function OfferEditor({
  values,
  categories,
  products,
}: {
  values: OfferEditorValues;
  categories: ReadonlyArray<{ code: string; nameAr: string }>;
  products: ReadonlyArray<{ id: string; nameAr: string; categoryId: string }>;
}) {
  const [step, setStep] = useState(0);
  const [kind, setKind] = useState<OfferKind>(values.kind);
  const [search, setSearch] = useState("");
  const [preview, previewAction, previewing] = useActionState(
    previewOfferAction,
    null,
  );
  const [saved, saveAction, saving] = useActionState(saveOfferAction, null);
  const form = useRef<HTMLFormElement>(null);
  // Dispatched by hand: a <form action> resets every field afterwards, which would wipe the
  // offer after a preview or a refused save.
  const run = (dispatch: (data: FormData) => void) => {
    const data = new FormData(form.current!);
    startTransition(() => dispatch(data));
  };
  const needle = search.trim();
  const visibleProducts = needle
    ? products.filter((product) => product.nameAr.includes(needle))
    : products;

  return (
    // Fields on hidden steps carry no browser validation; the server checks every field and says which.
    <form
      ref={form}
      className="admin-form admin-offer-editor"
      onSubmit={(event) => {
        event.preventDefault();
        run(saveAction);
      }}
    >
      {values.id ? (
        <>
          <input type="hidden" name="offerId" value={values.id} />
          <input type="hidden" name="version" value={values.version ?? ""} />
        </>
      ) : null}
      {/* Exact-variant targets come from the assistant; the form keeps them unchanged. */}
      {values.variantIds.map((variantId) => (
        <input
          key={variantId}
          type="hidden"
          name="variantIds"
          value={variantId}
        />
      ))}

      <ol className="admin-steps" aria-label="خطوات العرض">
        {steps.map((item, index) => (
          <li key={item.id}>
            <button
              type="button"
              className={index === step ? "is-current" : undefined}
              aria-current={index === step ? "step" : undefined}
              onClick={() => setStep(index)}
            >
              <span className="admin-step-number">{index + 1}</span>
              {item.label}
            </button>
          </li>
        ))}
      </ol>

      <fieldset hidden={step !== 0} className="admin-offer-step">
        <legend>ما الذي يشمله العرض؟</legend>
        <label>
          <span>اسم العرض (للإدارة)</span>
          <input name="nameAr" maxLength={80} defaultValue={values.nameAr} />
        </label>
        <fieldset className="admin-check-group">
          <legend>أقسام كاملة</legend>
          {categories.map((category) => (
            <label key={category.code} className="admin-check">
              <input
                type="checkbox"
                name="categoryCodes"
                value={category.code}
                defaultChecked={values.categoryCodes.includes(category.code)}
              />
              <span>{category.nameAr}</span>
            </label>
          ))}
        </fieldset>
        <fieldset className="admin-check-group">
          <legend>منتجات محددة</legend>
          <label>
            <span className="sr-only">بحث في المنتجات</span>
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="ابحثي باسم المنتج"
            />
          </label>
          {products.map((product) => (
            <label
              key={product.id}
              className="admin-check"
              hidden={!visibleProducts.includes(product)}
            >
              <input
                type="checkbox"
                name="productIds"
                value={product.id}
                defaultChecked={values.productIds.includes(product.id)}
              />
              <span>{product.nameAr}</span>
            </label>
          ))}
        </fieldset>
        {values.variantIds.length ? (
          <p className="admin-muted">
            يشمل أيضاً {values.variantIds.length} صنفاً محدداً أُضيف من المساعد،
            ويبقى كما هو.
          </p>
        ) : null}
      </fieldset>

      <fieldset hidden={step !== 1} className="admin-offer-step">
        <legend>كيف يتغير السعر؟</legend>
        <fieldset className="admin-check-group">
          <legend>نوع العرض</legend>
          {(Object.keys(offerKindLabels) as OfferKind[]).map((option) => (
            <label key={option} className="admin-check">
              <input
                type="radio"
                name="kind"
                value={option}
                checked={kind === option}
                onChange={() => setKind(option)}
              />
              <span>{offerKindLabels[option]}</span>
            </label>
          ))}
        </fieldset>
        <label>
          <span>
            {kind === "percentage"
              ? "نسبة الخصم ٪"
              : kind === "amount_off"
                ? "مبلغ الخصم للقطعة ₪"
                : "سعر القطعة في العرض ₪"}
          </span>
          <input
            name="value"
            inputMode={kind === "percentage" ? "numeric" : "decimal"}
            dir="ltr"
            defaultValue={values.value}
          />
        </label>
        <label>
          <span>أقل كمية ليُطبَّق العرض</span>
          <input
            name="minQuantity"
            type="number"
            min={1}
            max={100}
            dir="ltr"
            defaultValue={values.minQuantity}
          />
        </label>
        <label>
          <span>نص يظهر للزبون (اختياري)</span>
          <input
            name="displayText"
            maxLength={120}
            defaultValue={values.displayText}
          />
        </label>
        <p className="admin-muted">
          العرض يخفّض سعر القطعة الواحدة فقط؛ العبوات المتعددة تُباع بسعرها
          الخاص.
        </p>
      </fieldset>

      <fieldset hidden={step !== 2} className="admin-offer-step">
        <legend>متى يعمل العرض؟</legend>
        <label>
          <span>من تاريخ (اختياري)</span>
          <input
            name="startDate"
            type="date"
            dir="ltr"
            defaultValue={values.startDate}
          />
        </label>
        <label>
          <span>حتى نهاية يوم (اختياري)</span>
          <input
            name="endDate"
            type="date"
            dir="ltr"
            defaultValue={values.endDate}
          />
        </label>
        {values.roundsTimes ? (
          <p className="admin-note" role="note">
            هذا العرض يبدأ أو ينتهي في منتصف اليوم. الحفظ من هنا يجعله يبدأ أول
            اليوم وينتهي آخر اليوم المختار.
          </p>
        ) : null}
        <label className="admin-toggle">
          <input
            type="checkbox"
            name="enabled"
            defaultChecked={values.enabled}
          />
          <span>مفعّل</span>
        </label>
        <p className="admin-muted">
          العرض المفعّل لا يُحفظ إذا تداخل مع عرض مفعّل آخر على نفس الأصناف في
          نفس الفترة.
        </p>
      </fieldset>

      <fieldset hidden={step !== 3} className="admin-offer-step">
        <legend>المعاينة</legend>
        <button
          type="button"
          onClick={() => run(previewAction)}
          className="admin-btn admin-btn-secondary"
          disabled={previewing}
        >
          {previewing ? "جارٍ الحساب…" : "حساب الأسعار والتعارضات"}
        </button>
        {preview && !preview.ok ? (
          <p className="admin-form-error" role="alert">
            {preview.message}
          </p>
        ) : null}
        {preview?.ok ? (
          <div aria-live="polite">
            {preview.conflicts.length ? (
              <div className="admin-callout" role="alert">
                <strong>يتعارض عند التفعيل مع:</strong>
                <ul>
                  {preview.conflicts.map((conflict) => (
                    <li key={conflict.nameAr}>
                      «{conflict.nameAr}» على {conflict.variants.join("، ")}
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="admin-form-success" role="status">
                لا يتعارض مع أي عرض مفعّل.
              </p>
            )}
            <div className="admin-table-wrap">
              <table className="admin-data-table" aria-label="الأسعار في العرض">
                <thead>
                  <tr>
                    <th scope="col">الصنف</th>
                    <th scope="col">السعر الحالي</th>
                    <th scope="col">في العرض</th>
                    <th scope="col">الربح للقطعة</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((row) => (
                    <tr key={row.variantId}>
                      <td>{row.label}</td>
                      <td>{formatIls(row.listPriceAgorot)}</td>
                      <td>
                        {row.finalPriceAgorot === null
                          ? "لا يُطبَّق"
                          : formatIls(row.finalPriceAgorot)}
                      </td>
                      <td>
                        {row.finalPriceAgorot === null ||
                        row.avgCostAgorot === null
                          ? "—"
                          : formatIls(row.finalPriceAgorot - row.avgCostAgorot)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </fieldset>

      {saved ? (
        <p className="admin-form-error" role="alert">
          {saved.message}
        </p>
      ) : null}
      <div className="admin-form-actions admin-offer-nav">
        {step > 0 ? (
          <button
            type="button"
            className="admin-btn admin-btn-secondary"
            onClick={() => setStep(step - 1)}
          >
            السابق
          </button>
        ) : null}
        {step < steps.length - 1 ? (
          <button
            type="button"
            className="admin-btn admin-btn-secondary"
            onClick={() => setStep(step + 1)}
          >
            التالي: {steps[step + 1]!.label}
          </button>
        ) : null}
        <button
          type="submit"
          className="admin-btn admin-btn-primary"
          disabled={saving}
        >
          {saving ? "جارٍ الحفظ…" : values.id ? "حفظ العرض" : "إنشاء العرض"}
        </button>
      </div>
    </form>
  );
}
