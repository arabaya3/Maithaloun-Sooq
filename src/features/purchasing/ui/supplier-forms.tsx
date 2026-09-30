"use client";

import { useActionState, useState } from "react";

import {
  createSupplierAction,
  recordSupplierPaymentAction,
  type FormState,
} from "@/features/inventory/application/inventory-actions";

function Result({ state }: { state: FormState }) {
  return state ? (
    <p
      className={state.ok ? "admin-form-success" : "admin-form-error"}
      role={state.ok ? "status" : "alert"}
    >
      {state.message}
    </p>
  ) : null;
}

export function SupplierCreateForm() {
  const [state, action, pending] = useActionState(createSupplierAction, null);
  return (
    <form className="admin-form" action={action}>
      <div className="admin-field-grid">
        <label>
          اسم المورد
          <input name="nameAr" required minLength={2} maxLength={120} />
        </label>
        <label>
          رقم الهاتف (اختياري)
          <input name="phone" type="tel" inputMode="tel" dir="ltr" />
        </label>
      </div>
      <label>
        ملاحظات (اختياري)
        <input name="notes" maxLength={500} />
      </label>
      <Result state={state} />
      <button
        type="submit"
        className="admin-btn admin-btn-primary"
        disabled={pending}
      >
        {pending ? "جارٍ الحفظ…" : "إضافة المورد"}
      </button>
    </form>
  );
}

export function SupplierPaymentForm({ supplierId }: { supplierId: string }) {
  const [state, action, pending] = useActionState(
    recordSupplierPaymentAction,
    null,
  );
  const [keyState, setKeyState] = useState<{
    key: string | null;
    usedFor: FormState;
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

  return (
    <form className="admin-form admin-inline-form" action={submit}>
      <input type="hidden" name="supplierId" value={supplierId} />
      <label>
        دفعة للمورد ₪
        <input
          name="amount"
          required
          inputMode="decimal"
          dir="ltr"
          placeholder="0.00"
        />
      </label>
      <button
        type="submit"
        className="admin-btn admin-btn-secondary"
        disabled={pending}
      >
        تسجيل الدفعة
      </button>
      <Result state={state} />
    </form>
  );
}
