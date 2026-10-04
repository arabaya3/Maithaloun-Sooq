"use client";

import { useActionState } from "react";

import { createQaOrderAction } from "@/features/admin/application/qa-order-actions";

const ROWS = 3;

export function QaOrderForm({
  options,
}: {
  options: Array<{ value: string; label: string }>;
}) {
  const [state, action, pending] = useActionState(createQaOrderAction, null);
  return (
    <form
      action={action}
      className="admin-form admin-panel"
      aria-label="إنشاء طلب اختبار"
    >
      {Array.from({ length: ROWS }, (_, index) => (
        <div key={index} className="admin-media-form">
          <label>
            <span>الصنف {index + 1}</span>
            <select
              name={`variant-${index}`}
              defaultValue=""
              required={index === 0}
            >
              <option value="">—</option>
              {options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>الكمية</span>
            <input
              name={`quantity-${index}`}
              type="number"
              min={1}
              max={9}
              defaultValue={1}
            />
          </label>
        </div>
      ))}
      <label>
        <span>ملاحظة الاختبار (اختيارية)</span>
        <input name="note" maxLength={500} />
      </label>
      <button
        type="submit"
        className="admin-btn admin-btn-primary"
        disabled={pending}
      >
        إنشاء طلب اختبار
      </button>
      {state ? (
        <p className="admin-form-error" role="alert">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
