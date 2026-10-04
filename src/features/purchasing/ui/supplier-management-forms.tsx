"use client";

import { useActionState, useState } from "react";

import {
  recordSupplierCreditNoteAction,
  setSupplierActiveAction,
  updateSupplierAction,
  type SupplierFormState,
} from "@/features/purchasing/application/supplier-management-actions";

function Result({ state }: { state: SupplierFormState }) {
  return state ? (
    <p
      className={state.ok ? "admin-form-success" : "admin-form-error"}
      role={state.ok ? "status" : "alert"}
    >
      {state.message}
    </p>
  ) : null;
}

export function SupplierEditForm({
  supplier,
}: {
  supplier: {
    id: string;
    nameAr: string;
    phone: string | null;
    notes: string | null;
    active: boolean;
  };
}) {
  const [state, action, pending] = useActionState(updateSupplierAction, null);
  return (
    <form className="admin-form" action={action} aria-label="تعديل المورد">
      <input type="hidden" name="supplierId" value={supplier.id} />
      <input type="hidden" name="active" value={String(supplier.active)} />
      <div className="admin-field-grid">
        <label>
          اسم المورد
          <input
            name="nameAr"
            required
            minLength={2}
            maxLength={120}
            defaultValue={supplier.nameAr}
          />
        </label>
        <label>
          رقم الهاتف (اختياري)
          <input
            name="phone"
            type="tel"
            inputMode="tel"
            dir="ltr"
            defaultValue={supplier.phone ?? ""}
          />
        </label>
      </div>
      <label>
        ملاحظات (اختياري)
        <input
          name="notes"
          maxLength={500}
          defaultValue={supplier.notes ?? ""}
        />
      </label>
      <Result state={state} />
      <button
        type="submit"
        className="admin-btn admin-btn-primary"
        disabled={pending}
      >
        حفظ بيانات المورد
      </button>
    </form>
  );
}

export function SupplierArchiveForm({
  supplierId,
  active,
}: {
  supplierId: string;
  active: boolean;
}) {
  const [state, action, pending] = useActionState(
    setSupplierActiveAction,
    null,
  );
  return (
    <form className="admin-form admin-inline-form" action={action}>
      <input type="hidden" name="supplierId" value={supplierId} />
      <input type="hidden" name="active" value={String(!active)} />
      <button
        type="submit"
        className="admin-btn admin-btn-secondary"
        disabled={pending}
      >
        {active ? "أرشفة المورد" : "استعادة المورد"}
      </button>
      <Result state={state} />
    </form>
  );
}

export function SupplierCreditNoteForm({ supplierId }: { supplierId: string }) {
  const [state, action, pending] = useActionState(
    recordSupplierCreditNoteAction,
    null,
  );
  // One key per note: a double tap or retry after a lost response records it once.
  const [keyState, setKeyState] = useState<{
    key: string | null;
    usedFor: SupplierFormState;
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
    <form
      className="admin-form"
      action={submit}
      aria-label="إشعار دائن من المورد"
    >
      <input type="hidden" name="supplierId" value={supplierId} />
      <p className="admin-muted">
        سجّلي الإشعار الدائن الذي أصدره المورد (مثلاً عن بضاعة مرتجعة). يُخصم
        مبلغه من المستحق للمورد. إرجاع البضاعة من المخزون وحده لا يغيّر المستحق.
      </p>
      <div className="admin-field-grid">
        <label>
          المبلغ ₪
          <input
            name="amount"
            required
            inputMode="decimal"
            dir="ltr"
            placeholder="0.00"
          />
        </label>
        <label>
          رقم الإشعار
          <input name="reference" required maxLength={80} dir="ltr" />
        </label>
      </div>
      <label>
        السبب
        <input name="reason" required minLength={2} maxLength={240} />
      </label>
      <Result state={state} />
      <button
        type="submit"
        className="admin-btn admin-btn-secondary"
        disabled={pending}
      >
        تسجيل الإشعار الدائن
      </button>
    </form>
  );
}
