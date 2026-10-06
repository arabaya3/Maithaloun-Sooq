"use client";

import { useActionState, useState } from "react";

import {
  cancelInvoiceAction,
  reversePaymentAction,
  saveCustomerAction,
  type SalesFormState,
} from "@/features/sales/application/sales-actions";

export function Result({ state }: { state: SalesFormState }) {
  return state ? (
    <p
      className={state.ok ? "admin-form-success" : "admin-form-error"}
      role={state.ok ? "status" : "alert"}
    >
      {state.message}
    </p>
  ) : null;
}

function ReasonedAction({
  action,
  hidden,
  openLabel,
  confirmLabel,
  prompt,
}: {
  action: (
    previous: SalesFormState,
    formData: FormData,
  ) => Promise<SalesFormState>;
  hidden: Record<string, string>;
  openLabel: string;
  confirmLabel: string;
  prompt: string;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const [open, setOpen] = useState(false);
  if (state?.ok) return <Result state={state} />;
  if (!open) {
    return (
      <button
        key="open"
        type="button"
        className="admin-btn admin-btn-danger admin-btn-sm"
        onClick={() => setOpen(true)}
      >
        {openLabel}
      </button>
    );
  }
  return (
    <form className="admin-form admin-reasoned" action={formAction}>
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <label>
        {prompt}
        <input name="reason" required minLength={2} maxLength={240} />
      </label>
      <Result state={state} />
      <div className="admin-form-actions">
        <button
          key="confirm"
          type="submit"
          className="admin-btn admin-btn-danger"
          disabled={pending}
        >
          {confirmLabel}
        </button>
        <button
          key="back"
          type="button"
          className="admin-btn admin-btn-secondary"
          onClick={() => setOpen(false)}
        >
          تراجع
        </button>
      </div>
    </form>
  );
}

export function ReversePaymentForm({
  paymentId,
  customerId,
}: {
  paymentId: string;
  customerId: string;
}) {
  return (
    <ReasonedAction
      action={reversePaymentAction}
      hidden={{ paymentId, customerId }}
      openLabel="تصحيح: عكس الدفعة"
      confirmLabel="تأكيد عكس الدفعة"
      prompt="سبب التصحيح"
    />
  );
}

export function CancelInvoiceForm({
  invoiceId,
  customerId,
}: {
  invoiceId: string;
  customerId: string | null;
}) {
  return (
    <ReasonedAction
      action={cancelInvoiceAction}
      hidden={{ invoiceId, customerId: customerId ?? "" }}
      openLabel="إلغاء الفاتورة"
      confirmLabel="تأكيد الإلغاء وإرجاع البضاعة"
      prompt="سبب الإلغاء"
    />
  );
}

export function CustomerDetailsForm({
  customer,
}: {
  customer?: { id: string; name: string; phone: string; notes: string };
}) {
  const [state, action, pending] = useActionState(saveCustomerAction, null);
  return (
    <form className="admin-form" action={action}>
      {customer ? <input type="hidden" name="id" value={customer.id} /> : null}
      <div className="admin-field-grid">
        <label>
          اسم الزبون
          <input
            name="name"
            required
            minLength={2}
            maxLength={100}
            defaultValue={customer?.name}
          />
        </label>
        <label>
          رقم الهاتف (اختياري)
          <input
            name="phone"
            type="tel"
            inputMode="tel"
            dir="ltr"
            defaultValue={customer?.phone}
            placeholder="0591234567"
          />
        </label>
      </div>
      {customer ? (
        <label>
          لقب أو اسم آخر يُعرف به (اختياري)
          <input name="alias" maxLength={100} placeholder="مثال: أم محمد" />
        </label>
      ) : null}
      <label>
        ملاحظات (اختياري)
        <input name="notes" maxLength={500} defaultValue={customer?.notes} />
      </label>
      <Result state={state} />
      <button
        type="submit"
        className="admin-btn admin-btn-secondary"
        disabled={pending}
      >
        {pending ? "جارٍ الحفظ…" : customer ? "حفظ البيانات" : "إضافة الزبون"}
      </button>
    </form>
  );
}
