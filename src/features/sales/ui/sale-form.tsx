"use client";

import Link from "next/link";
import { CheckCircle2, Plus, Trash2 } from "lucide-react";
import { useMemo, useState, useTransition } from "react";

import { Money } from "@/features/admin/ui/kit";
import {
  formatQuantity,
  parseQuantityToMilli,
} from "@/features/inventory/domain/quantity";
import {
  VariantPicker,
  type VariantOption,
} from "@/features/inventory/ui/variant-picker";
import {
  postSaleAction,
  previewSaleAction,
} from "@/features/sales/application/sales-actions";
import type {
  SalePostResult,
  SalePreview,
} from "@/features/sales/application/sales-service";
import type { SaleSource } from "@/features/sales/domain/customer-balance";
import {
  buildSalePayload,
  emptySaleLine,
  parseSaleMoney,
  type SaleCustomerMode,
  type SaleDraft,
  type SaleDraftErrors,
  type SaleLineDraft,
  type SalePaymentChoice,
  type SalePayload,
} from "@/features/sales/domain/sale-draft";
import { lineTotalAgorot } from "@/shared/lib/money-math";
import { formatAgorotAsIlsInput } from "@/shared/lib/parse-ils";
import { useUnsavedChanges } from "@/shared/ui/use-unsaved-changes";

import { SaleReviewCard } from "./sale-review";

export interface SaleVariantOption extends VariantOption {
  priceAgorot: number;
  // Active ways to sell this variant; the first default is preselected.
  sellingUnits?: ReadonlyArray<{
    id: string;
    labelAr: string;
    unitsPerSale: number;
    priceAgorot: number;
    isDefault: boolean;
  }>;
}

const customerModes: { id: SaleCustomerMode; label: string }[] = [
  { id: "cash", label: "نقدي بدون اسم" },
  { id: "existing", label: "زبون مسجّل" },
  { id: "new", label: "زبون جديد" },
];

const paymentChoices: { id: SalePaymentChoice; label: string }[] = [
  { id: "paid", label: "دفع كامل" },
  { id: "unpaid", label: "على الحساب" },
  { id: "partial", label: "دفع جزء" },
];

function FieldError({ message }: { message?: string }) {
  return message ? (
    <small className="admin-field-error" role="alert">
      {message}
    </small>
  ) : null;
}

export function SaleForm({
  variants,
  customers,
  initialDraft,
  source = "manual",
  initialReview,
  onSaved,
}: {
  variants: readonly SaleVariantOption[];
  customers: readonly { id: string; name: string; balanceAgorot: number }[];
  initialDraft: SaleDraft;
  source?: SaleSource;
  initialReview?: { preview: SalePreview; payload: SalePayload };
  onSaved?: (result: SalePostResult, edited: boolean) => void;
}) {
  const [draft, setDraft] = useState(initialDraft);
  const [errors, setErrors] = useState<SaleDraftErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [review, setReview] = useState<{
    preview: SalePreview;
    payload: SalePayload;
  } | null>(initialReview ?? null);
  const [posted, setPosted] = useState<SalePostResult | null>(null);
  const [idempotencyKey] = useState(
    () => initialReview?.payload.idempotencyKey ?? crypto.randomUUID(),
  );
  const [pending, startTransition] = useTransition();
  const [dirty, setDirty] = useState(Boolean(initialReview));
  const [edited, setEdited] = useState(false);
  useUnsavedChanges(dirty && !posted);

  const runningTotal = useMemo(
    () =>
      draft.lines.reduce((sum, line) => {
        const quantity = parseQuantityToMilli(line.quantity);
        const price = parseSaleMoney(line.unitPrice);
        return quantity === null || price === null
          ? sum
          : sum + lineTotalAgorot(quantity, price);
      }, 0),
    [draft.lines],
  );

  function update(patch: Partial<SaleDraft>) {
    setDraft((current) => ({ ...current, ...patch }));
    setErrors({});
    setDirty(true);
    setEdited(true);
  }

  function updateLine(key: string, patch: Partial<SaleLineDraft>) {
    update({
      lines: draft.lines.map((line) =>
        line.key === key ? { ...line, ...patch } : line,
      ),
    });
  }

  function selectVariant(key: string, variantId: string) {
    const variant = variants.find((item) => item.variantId === variantId);
    const unit =
      variant?.sellingUnits?.find((item) => item.isDefault) ??
      variant?.sellingUnits?.[0];
    updateLine(key, {
      variantId,
      sellingUnitId: unit?.id ?? "",
      unitPrice: unit
        ? formatAgorotAsIlsInput(unit.priceAgorot)
        : variant
          ? formatAgorotAsIlsInput(variant.priceAgorot)
          : "",
    });
  }

  // Only multi-piece units change the wording; a one-piece unit reads like a normal sale.
  function packLine(line: SaleLineDraft) {
    const unit = variants
      .find((item) => item.variantId === line.variantId)
      ?.sellingUnits?.find((item) => item.id === line.sellingUnitId);
    return Boolean(unit && unit.unitsPerSale > 1);
  }

  function selectSellingUnit(key: string, variantId: string, unitId: string) {
    const variant = variants.find((item) => item.variantId === variantId);
    const unit = variant?.sellingUnits?.find((item) => item.id === unitId);
    updateLine(key, {
      sellingUnitId: unit?.id ?? "",
      unitPrice: formatAgorotAsIlsInput(
        unit?.priceAgorot ?? variant?.priceAgorot ?? 0,
      ),
    });
  }

  function openReview() {
    setFormError(null);
    const built = buildSalePayload(draft, { idempotencyKey, source });
    setErrors(built.errors);
    if (!built.payload) {
      setFormError("راجعي الحقول المحدّدة ثم حاولي مجدداً.");
      return;
    }
    const payload = built.payload;
    startTransition(async () => {
      const response = await previewSaleAction(payload);
      if (!response.ok) {
        setFormError(response.message);
        return;
      }
      setReview({ preview: response.preview, payload });
    });
  }

  function confirm() {
    if (!review) return;
    setFormError(null);
    startTransition(async () => {
      const response = await postSaleAction(review.payload);
      if (!response.ok) {
        setFormError(response.message);
        return;
      }
      setPosted(response.result);
      onSaved?.(response.result, edited);
    });
  }

  if (posted) {
    return (
      <section className="admin-panel admin-success-panel" aria-live="polite">
        <CheckCircle2 size={32} aria-hidden="true" />
        <h2>{posted.replayed ? "العملية محفوظة مسبقاً" : "تم حفظ البيع"}</h2>
        <p>
          فاتورة رقم <bdi dir="ltr">{posted.invoiceNumber}</bdi> بقيمة{" "}
          <Money agorot={posted.totalAgorot} />
          {posted.remainingAgorot > 0 ? (
            <>
              {" "}
              — الباقي على الزبون <Money agorot={posted.remainingAgorot} />
            </>
          ) : null}
        </p>
        <div className="admin-form-actions">
          <Link
            className="admin-btn admin-btn-primary"
            href={`/admin/sales/${posted.invoiceId}`}
            prefetch={false}
          >
            عرض الفاتورة ومشاركتها
          </Link>
          <Link
            className="admin-btn admin-btn-secondary"
            href="/admin/sales/new"
            prefetch={false}
          >
            بيع جديد
          </Link>
        </div>
      </section>
    );
  }

  if (review) {
    return (
      <section className="admin-panel" aria-labelledby="sale-review-title">
        <h2 id="sale-review-title">تأكيد عملية البيع</h2>
        <SaleReviewCard preview={review.preview} />
        {formError ? (
          <p className="admin-form-error" role="alert">
            {formError}
          </p>
        ) : null}
        <div className="admin-form-actions">
          <button
            type="button"
            className="admin-btn admin-btn-primary"
            disabled={pending || review.preview.blocked}
            onClick={confirm}
          >
            {pending ? "جارٍ الحفظ…" : "تأكيد وحفظ البيع"}
          </button>
          <button
            type="button"
            className="admin-btn admin-btn-secondary"
            disabled={pending}
            onClick={() => {
              setReview(null);
              setFormError(null);
            }}
          >
            رجوع للتعديل
          </button>
        </div>
      </section>
    );
  }

  return (
    <form
      className="admin-form"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        openReview();
      }}
    >
      <section
        className="admin-form-section"
        aria-labelledby="sale-lines-title"
      >
        <h2 id="sale-lines-title">ماذا بعتِ؟</h2>
        <FieldError message={errors.lines} />
        <ol className="admin-purchase-lines">
          {draft.lines.map((line, index) => (
            <li key={line.key}>
              <div className="admin-purchase-line-head">
                <span className="admin-purchase-line-number">{index + 1}</span>
                <VariantPicker
                  options={variants}
                  value={line.variantId}
                  label={`منتج السطر ${index + 1}`}
                  invalid={Boolean(errors[`${line.key}.variantId`])}
                  onChange={(variantId) => selectVariant(line.key, variantId)}
                />
                {draft.lines.length > 1 ? (
                  <button
                    type="button"
                    className="admin-btn admin-btn-ghost admin-btn-icon"
                    aria-label={`حذف السطر ${index + 1}`}
                    onClick={() =>
                      update({
                        lines: draft.lines.filter(
                          (item) => item.key !== line.key,
                        ),
                      })
                    }
                  >
                    <Trash2 size={18} aria-hidden="true" />
                  </button>
                ) : null}
              </div>
              {line.spokenText ? (
                <p className="admin-muted">
                  كما قيل: <bdi>{line.spokenText}</bdi>
                </p>
              ) : null}
              <FieldError message={errors[`${line.key}.variantId`]} />
              {(() => {
                const units =
                  variants.find((item) => item.variantId === line.variantId)
                    ?.sellingUnits ?? [];
                const unit = units.find(
                  (item) => item.id === line.sellingUnitId,
                );
                const packs = parseQuantityToMilli(line.quantity);
                return units.length ? (
                  <>
                    <label>
                      طريقة البيع
                      <select
                        aria-label={`طريقة البيع للسطر ${index + 1}`}
                        value={line.sellingUnitId}
                        onChange={(event) =>
                          selectSellingUnit(
                            line.key,
                            line.variantId,
                            event.target.value,
                          )
                        }
                      >
                        {units.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.labelAr} — يخصم {item.unitsPerSale}
                          </option>
                        ))}
                        <option value="">كمية حرة بالوحدة الأساسية</option>
                      </select>
                    </label>
                    {unit && unit.unitsPerSale > 1 && packs ? (
                      <p className="admin-muted" aria-live="polite">
                        {unit.labelAr} × {formatQuantity(packs)} ={" "}
                        {formatQuantity(packs * unit.unitsPerSale)} حبة من
                        المخزون
                      </p>
                    ) : null}
                  </>
                ) : null;
              })()}
              <div className="admin-field-grid admin-field-grid--pair">
                <label>
                  {packLine(line) ? "العدد" : "الكمية"}
                  <input
                    value={line.quantity}
                    inputMode="decimal"
                    dir="ltr"
                    aria-invalid={
                      Boolean(errors[`${line.key}.quantity`]) || undefined
                    }
                    onChange={(event) =>
                      updateLine(line.key, { quantity: event.target.value })
                    }
                  />
                  <FieldError message={errors[`${line.key}.quantity`]} />
                </label>
                <label>
                  {packLine(line) ? "السعر لكل باكيج ₪" : "سعر البيع ₪"}
                  <input
                    value={line.unitPrice}
                    inputMode="decimal"
                    dir="ltr"
                    placeholder="0.00"
                    aria-invalid={
                      Boolean(errors[`${line.key}.unitPrice`]) || undefined
                    }
                    onChange={(event) =>
                      updateLine(line.key, { unitPrice: event.target.value })
                    }
                  />
                  <FieldError message={errors[`${line.key}.unitPrice`]} />
                </label>
              </div>
            </li>
          ))}
        </ol>
        <button
          type="button"
          className="admin-btn admin-btn-secondary"
          onClick={() => update({ lines: [...draft.lines, emptySaleLine()] })}
        >
          <Plus size={18} aria-hidden="true" />
          إضافة منتج
        </button>
        <p className="admin-running-total">
          المجموع: <Money agorot={runningTotal} />
        </p>
      </section>

      <section
        className="admin-form-section"
        aria-labelledby="sale-customer-title"
      >
        <h2 id="sale-customer-title">لمن؟</h2>
        <fieldset className="admin-choice-group">
          <legend className="sr-only">نوع الزبون</legend>
          {customerModes.map((mode) => (
            <label key={mode.id} className="admin-choice">
              <input
                type="radio"
                name="customerMode"
                checked={draft.customerMode === mode.id}
                onChange={() =>
                  update({
                    customerMode: mode.id,
                    payment: mode.id === "cash" ? "paid" : draft.payment,
                  })
                }
              />
              <span>{mode.label}</span>
            </label>
          ))}
        </fieldset>
        {draft.customerMode === "existing" ? (
          <label>
            الزبون
            <select
              aria-label="الزبون"
              value={draft.customerId}
              aria-invalid={Boolean(errors.customer) || undefined}
              onChange={(event) => update({ customerId: event.target.value })}
            >
              <option value="">اختاري الزبون</option>
              {customers.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {draft.customerMode === "new" ? (
          <label>
            اسم الزبون
            <input
              value={draft.newCustomerName}
              maxLength={100}
              onChange={(event) =>
                update({ newCustomerName: event.target.value })
              }
            />
          </label>
        ) : null}
        <FieldError message={errors.customer} />
      </section>

      <section
        className="admin-form-section"
        aria-labelledby="sale-payment-title"
      >
        <h2 id="sale-payment-title">الدفع</h2>
        <fieldset className="admin-choice-group">
          <legend className="sr-only">طريقة الدفع</legend>
          {paymentChoices.map((choice) => (
            <label key={choice.id} className="admin-choice">
              <input
                type="radio"
                name="salePayment"
                checked={draft.payment === choice.id}
                disabled={draft.customerMode === "cash" && choice.id !== "paid"}
                onChange={() => update({ payment: choice.id })}
              />
              <span>{choice.label}</span>
            </label>
          ))}
        </fieldset>
        {draft.customerMode === "cash" ? (
          <p className="admin-muted">البيع على الحساب يحتاج اسم الزبون.</p>
        ) : null}
        {draft.payment === "partial" ? (
          <label>
            المبلغ المدفوع ₪
            <input
              value={draft.paid}
              inputMode="decimal"
              dir="ltr"
              aria-invalid={Boolean(errors.paid) || undefined}
              onChange={(event) => update({ paid: event.target.value })}
            />
            <FieldError message={errors.paid} />
          </label>
        ) : null}
        <details className="admin-disclosure">
          <summary>خصم أو ملاحظة</summary>
          <label>
            خصم ₪
            <input
              value={draft.discount}
              inputMode="decimal"
              dir="ltr"
              onChange={(event) => update({ discount: event.target.value })}
            />
            <FieldError message={errors.discount} />
          </label>
          <label>
            ملاحظة
            <input
              value={draft.note}
              maxLength={300}
              onChange={(event) => update({ note: event.target.value })}
            />
          </label>
        </details>
      </section>

      {formError ? (
        <p className="admin-form-error" role="alert">
          {formError}
        </p>
      ) : null}
      <div className="admin-form-actions">
        <button
          type="submit"
          className="admin-btn admin-btn-primary"
          disabled={pending}
        >
          {pending ? "جارٍ التحضير…" : "مراجعة البيع"}
        </button>
      </div>
    </form>
  );
}
