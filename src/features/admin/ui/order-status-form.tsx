"use client";

import { useActionState } from "react";

import { updateOrderStatusAction } from "@/features/admin/application/admin-actions";
import {
  getAllowedTransitions,
  orderStatusLabels,
  type OrderStatus,
} from "@/features/orders/domain/order-status";

export function OrderStatusForm({
  publicReference,
  status,
  version,
}: {
  publicReference: string;
  status: OrderStatus;
  version: number;
}) {
  const transitions = getAllowedTransitions(status);
  const [state, formAction, pending] = useActionState(
    async (
      _previous: { ok: false; message: string } | null,
      formData: FormData,
    ) => (await updateOrderStatusAction(formData)) ?? null,
    null,
  );

  if (!transitions.length) {
    return <p className="admin-muted">هذه الحالة نهائية ولا يمكن تغييرها.</p>;
  }

  return (
    <form className="admin-form" action={formAction}>
      <input type="hidden" name="publicReference" value={publicReference} />
      <input type="hidden" name="expectedVersion" value={String(version)} />
      <fieldset>
        <legend>تحديث الحالة</legend>
        <div className="admin-status-actions">
          {transitions.map((nextStatus) => (
            <button
              key={nextStatus}
              type="submit"
              name="nextStatus"
              value={nextStatus}
              disabled={pending}
            >
              {orderStatusLabels[nextStatus]}
            </button>
          ))}
        </div>
        <label htmlFor="order-reason">سبب داخلي اختياري</label>
        <input id="order-reason" name="reason" maxLength={180} />
      </fieldset>
      {state?.message ? (
        <p className="admin-form-error" role="alert">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
