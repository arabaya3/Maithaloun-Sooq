"use client";

import Link from "next/link";
import { CheckCircle2, Plus, Trash2 } from "lucide-react";
import { useMemo, useState, useTransition } from "react";

import { Money } from "@/features/admin/ui/kit";
import {
  createProductForLineAction,
  postPurchaseAction,
  previewPurchaseAction,
} from "@/features/inventory/application/inventory-actions";
import { parseQuantityToMilli } from "@/features/inventory/domain/quantity";
import {
  stockUnitLabels,
  stockUnits,
  type StockUnit,
} from "@/features/inventory/domain/stock-constants";
import {
  VariantPicker,
  type CreateVariant,
  type VariantOption,
} from "@/features/inventory/ui/variant-picker";
import type {
  PurchasePostResult,
  PurchasePreview,
} from "@/features/purchasing/application/purchase-service";
import type { PurchaseSource } from "@/features/purchasing/domain/purchase-constants";
import {
  NEW_SUPPLIER,
  buildPurchasePayload,
  emptyPurchaseLine,
  parseMoney,
  type DraftErrors,
  type PaymentChoice,
  type PurchaseDraft,
  type PurchaseLineDraft,
  type PurchasePayload,
} from "@/features/purchasing/domain/purchase-draft";
import { lineTotalAgorot } from "@/shared/lib/money-math";
import { useUnsavedChanges } from "@/shared/ui/use-unsaved-changes";

import { PurchaseLineImpacts, PurchaseReviewSummary } from "./purchase-review";

export interface PurchaseVariantOption extends VariantOption {
  unit: StockUnit;
}

function FieldError({ id, message }: { id: string; message?: string }) {
  return message ? (
    <small id={id} className="admin-field-error" role="alert">
      {message}
    </small>
  ) : null;
}

const paymentChoices: { id: PaymentChoice; label: string }[] = [
  { id: "paid", label: "مدفوعة كاملة" },
  { id: "unpaid", label: "غير مدفوعة" },
  { id: "partial", label: "مدفوعة جزئياً" },
];

export function PurchaseForm({
  variants,
  suppliers,
  initialDraft,
  source = "manual",
  documentId,
  extractionJobId,
  idempotencyKey: providedKey,
  onPosted,
}: {
  variants: readonly PurchaseVariantOption[];
  suppliers: readonly { id: string; nameAr: string }[];
  initialDraft: PurchaseDraft;
  source?: PurchaseSource;
  documentId?: string;
  extractionJobId?: string;
  idempotencyKey?: string;
  onPosted?: (payload: PurchasePayload) => Promise<{
    ok: boolean;
    message?: string;
    result?: PurchasePostResult;
  }>;
}) {
  const [draft, setDraft] = useState(initialDraft);
  const [variantOptions, setVariantOptions] = useState(variants);
  const [errors, setErrors] = useState<DraftErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [review, setReview] = useState<{
    preview: PurchasePreview;
    payload: PurchasePayload;
  } | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [posted, setPosted] = useState<PurchasePostResult | null>(null);
  const [idempotencyKey] = useState(() => providedKey ?? crypto.randomUUID());
  const [pending, startTransition] = useTransition();
  const [dirty, setDirty] = useState(false);
  useUnsavedChanges(dirty && !posted);

  const runningTotal = useMemo(
    () =>
      draft.lines.reduce((sum, line) => {
        const quantity = parseQuantityToMilli(line.quantity);
        const cost = parseMoney(line.unitCost);
        if (quantity === null || cost === null) return sum;
        return (
          sum +
          lineTotalAgorot(quantity, cost) -
          (parseMoney(line.lineDiscount) ?? 0)
        );
      }, 0),
    [draft.lines],
  );

  function clearErrors(keys: string[]) {
    setErrors((current) => {
      if (!keys.some((key) => key in current)) return current;
      const next = { ...current };
      for (const key of keys) delete next[key];
      return next;
    });
  }

  function update(patch: Partial<PurchaseDraft>) {
    setDraft((current) => ({ ...current, ...patch }));
    clearErrors([
      ...Object.keys(patch),
      ...("supplierId" in patch || "newSupplierName" in patch
        ? ["supplier"]
        : []),
    ]);
    setDirty(true);
  }

  function updateLine(key: string, patch: Partial<PurchaseLineDraft>) {
    setDraft((current) => ({
      ...current,
      lines: current.lines.map((line) =>
        line.key === key ? { ...line, ...patch } : line,
      ),
    }));
    clearErrors(Object.keys(patch).map((field) => `${key}.${field}`));
    setDirty(true);
  }

  function selectVariant(key: string, variantId: string) {
    const variant = variantOptions.find((item) => item.variantId === variantId);
    updateLine(
      key,
      variant ? { variantId, unit: variant.unit } : { variantId },
    );
  }

  const createVariant: CreateVariant = async (input) => {
    const response = await createProductForLineAction(input);
    if (!response.ok) return response;
    setVariantOptions((current) => [
      ...current,
      {
        variantId: response.variant.variantId,
        name: response.variant.name,
        variantLabel: null,
        sku: null,
        barcode: null,
        unit: "piece",
        hint: "منتج جديد",
      },
    ]);
    return { ok: true, variantId: response.variant.variantId };
  };

  function build(acknowledgeDuplicate: boolean) {
    const built = buildPurchasePayload(draft, {
      idempotencyKey,
      source,
      acknowledgeDuplicate,
      documentId,
      extractionJobId,
    });
    setErrors(built.errors);
    if (!built.payload) {
      setFormError("راجعي الحقول المحدّدة ثم حاولي مجدداً.");
    }
    return built.payload;
  }

  function openReview() {
    setFormError(null);
    const payload = build(false);
    if (!payload) return;
    startTransition(async () => {
      const response = await previewPurchaseAction(payload);
      if (!response.ok) {
        setFormError(response.message);
        return;
      }
      setAcknowledged(false);
      setReview({ preview: response.preview, payload });
    });
  }

  function confirm() {
    if (!review) return;
    setFormError(null);
    const payload = { ...review.payload, acknowledgeDuplicate: acknowledged };
    startTransition(async () => {
      const response = onPosted
        ? await onPosted(payload)
        : await postPurchaseAction(payload).then((value) =>
            value.ok
              ? { ok: true, result: value.result }
              : { ok: false, message: value.message },
          );
      if (!response.ok || !response.result) {
        setFormError(response.message ?? "تعذّر حفظ الفاتورة.");
        return;
      }
      setPosted(response.result);
    });
  }

  const supplierName =
    draft.supplierId === NEW_SUPPLIER
      ? draft.newSupplierName.trim()
      : (suppliers.find((item) => item.id === draft.supplierId)?.nameAr ?? "");

  if (posted) {
    return (
      <section className="admin-panel admin-success-panel" aria-live="polite">
        <CheckCircle2 size={32} aria-hidden="true" />
        <h2>
          {posted.replayed ? "الفاتورة محفوظة مسبقاً" : "تم حفظ فاتورة الشراء"}
        </h2>
        <p className="admin-muted">
          أُضيفت الكميات إلى المخزون وسُجّلت الحركة في السجل.
        </p>
        {posted.lines.length ? (
          <PurchaseLineImpacts lines={posted.lines} />
        ) : null}
        <div className="admin-form-actions">
          <Link
            className="admin-btn admin-btn-primary"
            href={`/admin/inventory/purchases/${posted.invoiceId}`}
            prefetch={false}
          >
            عرض الفاتورة
          </Link>
          <Link
            className="admin-btn admin-btn-secondary"
            href="/admin/inventory"
            prefetch={false}
          >
            العودة إلى المخزون
          </Link>
        </div>
      </section>
    );
  }

  if (review) {
    const blocked = review.preview.duplicate === "exact";
    const needsAcknowledge = review.preview.duplicate === "possible";
    return (
      <section className="admin-panel" aria-labelledby="purchase-review-title">
        <h2 id="purchase-review-title">راجعي قبل الحفظ</h2>
        <PurchaseReviewSummary
          preview={review.preview}
          supplierName={supplierName}
          reference={draft.reference.trim()}
          invoiceDate={draft.invoiceDate}
        />
        {needsAcknowledge ? (
          <label className="admin-check">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(event) => setAcknowledged(event.target.checked)}
            />
            <span>
              توجد فاتورة مشابهة لنفس المورد والتاريخ والمبلغ. أؤكد أن هذه
              فاتورة مختلفة.
            </span>
          </label>
        ) : null}
        {formError ? (
          <p className="admin-form-error" role="alert">
            {formError}
          </p>
        ) : null}
        <div className="admin-form-actions">
          <button
            type="button"
            className="admin-btn admin-btn-primary"
            disabled={pending || blocked || (needsAcknowledge && !acknowledged)}
            onClick={confirm}
          >
            {pending ? "جارٍ الحفظ…" : "تأكيد وحفظ في المخزون"}
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
      <section className="admin-form-section" aria-labelledby="supplier-title">
        <h2 id="supplier-title">المورد والفاتورة</h2>
        <label>
          المورد
          <select
            aria-label="المورد"
            value={draft.supplierId}
            aria-invalid={Boolean(errors.supplier) || undefined}
            aria-describedby="error-supplier"
            onChange={(event) => update({ supplierId: event.target.value })}
          >
            <option value="">اختاري المورد</option>
            {suppliers.map((supplier) => (
              <option key={supplier.id} value={supplier.id}>
                {supplier.nameAr}
              </option>
            ))}
            <option value={NEW_SUPPLIER}>+ مورد جديد</option>
          </select>
        </label>
        {draft.supplierId === NEW_SUPPLIER ? (
          <label>
            اسم المورد الجديد
            <input
              value={draft.newSupplierName}
              maxLength={120}
              onChange={(event) =>
                update({ newSupplierName: event.target.value })
              }
            />
          </label>
        ) : null}
        <FieldError id="error-supplier" message={errors.supplier} />
        <div className="admin-field-grid">
          <label>
            رقم الفاتورة (اختياري)
            <input
              value={draft.reference}
              dir="ltr"
              maxLength={60}
              onChange={(event) => update({ reference: event.target.value })}
            />
          </label>
          <label>
            تاريخ الفاتورة
            <input
              type="date"
              value={draft.invoiceDate}
              aria-invalid={Boolean(errors.invoiceDate) || undefined}
              aria-describedby="error-invoiceDate"
              onChange={(event) => update({ invoiceDate: event.target.value })}
            />
            <FieldError id="error-invoiceDate" message={errors.invoiceDate} />
          </label>
        </div>
      </section>

      <section className="admin-form-section" aria-labelledby="lines-title">
        <h2 id="lines-title">الأصناف</h2>
        <FieldError id="error-lines" message={errors.lines} />
        <ol className="admin-purchase-lines">
          {draft.lines.map((line, index) => (
            <li key={line.key}>
              <div className="admin-purchase-line-head">
                <span className="admin-purchase-line-number">{index + 1}</span>
                <VariantPicker
                  options={variantOptions}
                  value={line.variantId}
                  label={`منتج السطر ${index + 1}`}
                  invalid={Boolean(errors[`${line.key}.variantId`])}
                  onChange={(variantId) => selectVariant(line.key, variantId)}
                  onCreate={createVariant}
                  createDefaultName={line.sourceText ?? ""}
                />
                {draft.lines.length > 1 ? (
                  <button
                    type="button"
                    className="admin-btn admin-btn-ghost admin-btn-icon"
                    aria-label={`${line.sourceLineNo ? "تجاهل" : "حذف"} السطر ${index + 1}`}
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
              {line.sourceText ? (
                <p className="admin-muted">
                  كما ورد في المصدر: <bdi>{line.sourceText}</bdi>
                  {typeof line.confidence === "number" ? (
                    <>
                      {" "}
                      · درجة الثقة <bdi dir="ltr">{line.confidence}%</bdi>
                    </>
                  ) : null}
                </p>
              ) : null}
              {line.sourceLineNo && !line.variantId ? (
                <div
                  className="admin-suggestions"
                  role="group"
                  aria-label={`اقتراحات السطر ${index + 1}`}
                >
                  <p>
                    {line.suggestions?.length
                      ? "لم يُطابق تلقائياً. اختاري المنتج الصحيح:"
                      : "لا يوجد منتج مطابق. اختاريه يدوياً أو أنشئي منتجاً جديداً أو تجاهلي السطر."}
                  </p>
                  {line.suggestions?.map((suggestion) => (
                    <button
                      key={suggestion.variantId}
                      type="button"
                      className="admin-suggestion"
                      onClick={() =>
                        selectVariant(line.key, suggestion.variantId)
                      }
                    >
                      <span>
                        {suggestion.label}
                        <small>
                          {variantOptions.find(
                            (option) =>
                              option.variantId === suggestion.variantId,
                          )?.hint ?? ""}
                        </small>
                      </span>
                      <small>
                        تشابه <bdi dir="ltr">{suggestion.score}%</bdi>
                      </small>
                    </button>
                  ))}
                </div>
              ) : null}
              <FieldError
                id={`error-${line.key}-variant`}
                message={errors[`${line.key}.variantId`]}
              />
              <div className="admin-field-grid admin-field-grid--pair">
                <label>
                  الكمية
                  <input
                    value={line.quantity}
                    inputMode="decimal"
                    dir="ltr"
                    aria-invalid={
                      Boolean(errors[`${line.key}.quantity`]) || undefined
                    }
                    aria-describedby={`error-${line.key}-quantity`}
                    onChange={(event) =>
                      updateLine(line.key, { quantity: event.target.value })
                    }
                  />
                  <FieldError
                    id={`error-${line.key}-quantity`}
                    message={errors[`${line.key}.quantity`]}
                  />
                </label>
                <label>
                  سعر الشراء ({stockUnitLabels[line.unit]}) ₪
                  <input
                    value={line.unitCost}
                    inputMode="decimal"
                    dir="ltr"
                    placeholder="0.00"
                    aria-invalid={
                      Boolean(errors[`${line.key}.unitCost`]) || undefined
                    }
                    aria-describedby={`error-${line.key}-unitCost`}
                    onChange={(event) =>
                      updateLine(line.key, { unitCost: event.target.value })
                    }
                  />
                  <FieldError
                    id={`error-${line.key}-unitCost`}
                    message={errors[`${line.key}.unitCost`]}
                  />
                </label>
              </div>
              <details className="admin-disclosure">
                <summary>الوحدة والكرتونة والخصم</summary>
                <div className="admin-field-grid">
                  <label>
                    وحدة الشراء
                    <select
                      aria-label="وحدة الشراء"
                      value={line.unit}
                      onChange={(event) =>
                        updateLine(line.key, {
                          unit: event.target.value as StockUnit,
                        })
                      }
                    >
                      {stockUnits.map((unit) => (
                        <option key={unit} value={unit}>
                          {stockUnitLabels[unit]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    عدد الحبات داخل وحدة الشراء
                    <input
                      value={line.packQuantity}
                      inputMode="numeric"
                      dir="ltr"
                      aria-invalid={
                        Boolean(errors[`${line.key}.packQuantity`]) || undefined
                      }
                      onChange={(event) =>
                        updateLine(line.key, {
                          packQuantity: event.target.value,
                        })
                      }
                    />
                    <FieldError
                      id={`error-${line.key}-pack`}
                      message={errors[`${line.key}.packQuantity`]}
                    />
                  </label>
                  <label>
                    خصم على السطر ₪
                    <input
                      value={line.lineDiscount}
                      inputMode="decimal"
                      dir="ltr"
                      onChange={(event) =>
                        updateLine(line.key, {
                          lineDiscount: event.target.value,
                        })
                      }
                    />
                    <FieldError
                      id={`error-${line.key}-discount`}
                      message={errors[`${line.key}.lineDiscount`]}
                    />
                  </label>
                </div>
              </details>
            </li>
          ))}
        </ol>
        <button
          type="button"
          className="admin-btn admin-btn-secondary"
          onClick={() =>
            update({ lines: [...draft.lines, emptyPurchaseLine()] })
          }
        >
          <Plus size={18} aria-hidden="true" />
          إضافة صنف
        </button>
        <p className="admin-running-total">
          مجموع الأسطر: <Money agorot={runningTotal} />
        </p>
      </section>

      <section className="admin-form-section" aria-labelledby="payment-title">
        <h2 id="payment-title">الدفع</h2>
        <fieldset className="admin-choice-group">
          <legend className="sr-only">حالة الدفع</legend>
          {paymentChoices.map((choice) => (
            <label key={choice.id} className="admin-choice">
              <input
                type="radio"
                name="payment"
                checked={draft.payment === choice.id}
                onChange={() => update({ payment: choice.id })}
              />
              <span>{choice.label}</span>
            </label>
          ))}
        </fieldset>
        {draft.payment === "partial" ? (
          <label>
            المبلغ المدفوع ₪
            <input
              value={draft.paid}
              inputMode="decimal"
              dir="ltr"
              aria-invalid={Boolean(errors.paid) || undefined}
              aria-describedby="error-paid"
              onChange={(event) => update({ paid: event.target.value })}
            />
            <FieldError id="error-paid" message={errors.paid} />
          </label>
        ) : null}
        <details className="admin-disclosure">
          <summary>خصم أو ضريبة أو ملاحظات</summary>
          <div className="admin-field-grid">
            <label>
              خصم على الفاتورة ₪
              <input
                value={draft.discount}
                inputMode="decimal"
                dir="ltr"
                aria-invalid={Boolean(errors.discount) || undefined}
                onChange={(event) => update({ discount: event.target.value })}
              />
              <FieldError id="error-discount" message={errors.discount} />
            </label>
            <label>
              ضريبة مكتوبة في الفاتورة ₪
              <input
                value={draft.tax}
                inputMode="decimal"
                dir="ltr"
                onChange={(event) => update({ tax: event.target.value })}
              />
              <FieldError id="error-tax" message={errors.tax} />
            </label>
            <label>
              الإجمالي المطبوع في الفاتورة ₪
              <input
                value={draft.printedTotal}
                inputMode="decimal"
                dir="ltr"
                onChange={(event) =>
                  update({ printedTotal: event.target.value })
                }
              />
              <FieldError
                id="error-printedTotal"
                message={errors.printedTotal}
              />
            </label>
          </div>
          <label>
            ملاحظات
            <textarea
              value={draft.notes}
              rows={2}
              maxLength={500}
              onChange={(event) => update({ notes: event.target.value })}
            />
          </label>
        </details>
      </section>

      {formError ? (
        <p className="admin-form-error" role="alert">
          {formError}
        </p>
      ) : null}
      <div className="admin-form-actions admin-form-actions--sticky">
        <button
          type="submit"
          className="admin-btn admin-btn-primary"
          disabled={pending}
        >
          {pending ? "جارٍ التحضير…" : "مراجعة الفاتورة"}
        </button>
      </div>
    </form>
  );
}
