"use client";

import { useActionState, useState } from "react";

import {
  adjustStockAction,
  setReorderThresholdAction,
} from "@/features/inventory/application/inventory-actions";
import { formatQuantity } from "@/features/inventory/domain/quantity";
import {
  stockUnitLabels,
  stockUnits,
  type AdjustmentReason,
  type StockUnit,
} from "@/features/inventory/domain/stock-constants";

const reasonOptions: {
  id: AdjustmentReason;
  label: string;
  quantityLabel: string;
  needsCost: "always" | "optional" | "never";
}[] = [
  {
    id: "correction",
    label: "جرد: تصحيح الكمية الفعلية",
    quantityLabel: "الكمية الموجودة فعلياً",
    needsCost: "optional",
  },
  {
    id: "opening_balance",
    label: "رصيد افتتاحي",
    quantityLabel: "الكمية المضافة",
    needsCost: "always",
  },
  {
    id: "damaged",
    label: "تالف",
    quantityLabel: "الكمية التالفة",
    needsCost: "never",
  },
  {
    id: "expired",
    label: "منتهي الصلاحية",
    quantityLabel: "الكمية المنتهية",
    needsCost: "never",
  },
  {
    id: "customer_return",
    label: "مرتجع من زبون",
    quantityLabel: "الكمية المرتجعة",
    needsCost: "optional",
  },
  {
    id: "supplier_return",
    label: "مرتجع للمورد",
    quantityLabel: "الكمية المعادة للمورد",
    needsCost: "never",
  },
];

export function StockAdjustForm({
  variantId,
  tracked,
  unit,
  onHandMilli,
}: {
  variantId: string;
  tracked: boolean;
  unit: StockUnit;
  onHandMilli: number;
}) {
  const [reason, setReason] = useState<AdjustmentReason>(
    tracked ? "correction" : "opening_balance",
  );
  const [state, action, pending] = useActionState(adjustStockAction, null);
  // The key is created on first submit and renewed after a saved adjustment, so retries stay idempotent.
  const [keyState, setKeyState] = useState<{
    key: string | null;
    usedFor: typeof state;
  }>({ key: null, usedFor: state });
  if (state?.ok && keyState.usedFor !== state) {
    setKeyState({ key: null, usedFor: state });
  }
  function submit(formData: FormData) {
    const key = keyState.key ?? crypto.randomUUID();
    if (!keyState.key) setKeyState({ key, usedFor: keyState.usedFor });
    formData.set("idempotencyKey", key);
    action(formData);
  }
  const option = reasonOptions.find((item) => item.id === reason)!;
  const available = tracked
    ? reasonOptions
    : reasonOptions.filter((item) => item.id === "opening_balance");

  return (
    <form className="admin-form" action={submit}>
      <input type="hidden" name="variantId" value={variantId} />
      <label>
        نوع التعديل
        <select
          aria-label="نوع التعديل"
          name="reason"
          value={reason}
          onChange={(event) =>
            setReason(event.target.value as AdjustmentReason)
          }
        >
          {available.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
      </label>
      <div className="admin-field-grid">
        <label>
          {option.quantityLabel}
          <input
            name="quantity"
            required
            inputMode="decimal"
            dir="ltr"
            placeholder={
              reason === "correction" ? formatQuantity(onHandMilli) : "0"
            }
          />
        </label>
        {tracked ? (
          <input type="hidden" name="unit" value={unit} />
        ) : (
          <label>
            وحدة التخزين
            <select aria-label="وحدة التخزين" name="unit" defaultValue="piece">
              {stockUnits.map((item) => (
                <option key={item} value={item}>
                  {stockUnitLabels[item]}
                </option>
              ))}
            </select>
          </label>
        )}
        {option.needsCost === "never" ? null : (
          <label>
            سعر شراء الوحدة بالشيكل
            {option.needsCost === "optional" ? " (اختياري)" : ""}
            <input
              name="unitCost"
              required={option.needsCost === "always"}
              inputMode="decimal"
              dir="ltr"
              placeholder="0.00"
            />
          </label>
        )}
      </div>
      <label>
        ملاحظة (اختياري)
        <input name="note" maxLength={240} />
      </label>
      {state ? (
        <p
          className={state.ok ? "admin-form-success" : "admin-form-error"}
          role={state.ok ? "status" : "alert"}
        >
          {state.message}
        </p>
      ) : null}
      <button
        type="submit"
        className="admin-btn admin-btn-primary"
        disabled={pending}
      >
        {pending ? "جارٍ الحفظ…" : "حفظ التعديل"}
      </button>
    </form>
  );
}

export function ReorderThresholdForm({
  variantId,
  thresholdMilli,
}: {
  variantId: string;
  thresholdMilli: number | null;
}) {
  const [state, action, pending] = useActionState(
    setReorderThresholdAction,
    null,
  );
  return (
    <form className="admin-form admin-inline-form" action={action}>
      <input type="hidden" name="variantId" value={variantId} />
      <label>
        نبّهيني عندما يصل المتوفر إلى
        <input
          name="threshold"
          inputMode="decimal"
          dir="ltr"
          defaultValue={
            thresholdMilli === null ? "" : formatQuantity(thresholdMilli)
          }
          placeholder="بدون تنبيه"
        />
      </label>
      <button
        type="submit"
        className="admin-btn admin-btn-secondary"
        disabled={pending}
      >
        حفظ الحد
      </button>
      {state ? (
        <p
          className={state.ok ? "admin-form-success" : "admin-form-error"}
          role={state.ok ? "status" : "alert"}
        >
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
