"use client";

import { useActionState, useState } from "react";

import {
  recordCustomerPaymentAction,
  type SalesFormState,
} from "@/features/sales/application/sales-actions";
import { formatIls } from "@/shared/lib/format-currency";
import { parseIlsToAgorot } from "@/shared/lib/parse-ils";

import { Result } from "./customer-forms";

/** Previous balance, this payment and the balance after it, before the owner saves; the server re-checks. */
function PaymentPreview({
  balanceAgorot,
  amount,
}: {
  balanceAgorot: number;
  amount: string;
}) {
  const paid = amount.trim() ? parseIlsToAgorot(amount) : null;
  const valid = paid !== null && paid > 0;
  const after = valid ? balanceAgorot - paid : null;
  return (
    <dl className="admin-payment-preview" aria-live="polite">
      <div>
        <dt>الرصيد الحالي</dt>
        <dd className="admin-num">{formatIls(balanceAgorot)}</dd>
      </div>
      <div>
        <dt>هذه الدفعة</dt>
        <dd className="admin-num">{valid ? `− ${formatIls(paid)}` : "—"}</dd>
      </div>
      <div className="admin-payment-preview-result">
        <dt>الرصيد بعد الدفعة</dt>
        <dd className="admin-num">
          {after === null ? "—" : formatIls(Math.max(after, 0))}
        </dd>
      </div>
      {after !== null && after < 0 ? (
        <p className="admin-form-error">
          المبلغ أكبر من الرصيد المستحق بـ {formatIls(-after)}.
        </p>
      ) : null}
      {amount.trim() && !valid ? (
        <p className="admin-form-error">
          اكتبي المبلغ بالشيكل، مثل 25 أو 12.50.
        </p>
      ) : null}
    </dl>
  );
}

export function CustomerPaymentForm({
  customerId,
  balanceAgorot,
}: {
  customerId: string;
  balanceAgorot: number;
}) {
  const [amount, setAmount] = useState("");
  const [state, action, pending] = useActionState(
    recordCustomerPaymentAction,
    null,
  );
  const [keyState, setKeyState] = useState<{
    key: string | null;
    usedFor: SalesFormState;
  }>({ key: null, usedFor: state });
  if (state?.ok && keyState.usedFor !== state) {
    setKeyState({ key: null, usedFor: state });
    // A recorded payment clears the amount, so the same payment is not sent twice.
    setAmount("");
  }
  function submit(formData: FormData) {
    const key = keyState.key ?? crypto.randomUUID();
    if (!keyState.key) setKeyState({ key, usedFor: keyState.usedFor });
    formData.set("idempotencyKey", key);
    action(formData);
  }

  return (
    <form className="admin-form" action={submit}>
      <input type="hidden" name="customerId" value={customerId} />
      <div className="admin-field-grid">
        <label>
          المبلغ المستلم ₪
          <input
            name="amount"
            required
            inputMode="decimal"
            dir="ltr"
            placeholder="0.00"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
        </label>
        <label>
          ملاحظة (اختياري)
          <input name="note" maxLength={240} />
        </label>
      </div>
      <PaymentPreview balanceAgorot={balanceAgorot} amount={amount} />
      <Result state={state} />
      <button
        type="submit"
        className="admin-btn admin-btn-primary"
        disabled={pending}
      >
        {pending ? "جارٍ الحفظ…" : "تسجيل دفعة"}
      </button>
    </form>
  );
}
