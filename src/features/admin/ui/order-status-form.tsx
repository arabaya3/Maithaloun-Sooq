"use client";

import { useActionState, useState } from "react";

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
  const [confirmCancel, setConfirmCancel] = useState(false);
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

  const advance = transitions.filter((value) => value !== "cancelled");
  const canCancel = transitions.includes("cancelled");

  return (
    <form className="admin-form admin-status-form" action={formAction}>
      <input type="hidden" name="publicReference" value={publicReference} />
      <input type="hidden" name="expectedVersion" value={String(version)} />
      <div className="admin-status-actions">
        {advance.map((nextStatus) => (
          <button
            key={nextStatus}
            type="submit"
            name="nextStatus"
            value={nextStatus}
            disabled={pending}
            className="admin-button-primary"
          >
            نقل إلى {orderStatusLabels[nextStatus]}
          </button>
        ))}
      </div>

      <label htmlFor="order-reason">سبب داخلي اختياري</label>
      <input id="order-reason" name="reason" maxLength={180} />

      {canCancel ? (
        <div className="admin-cancel-block">
          {!confirmCancel ? (
            <button
              type="button"
              className="admin-button-danger"
              onClick={() => setConfirmCancel(true)}
              disabled={pending}
            >
              إلغاء الطلب
            </button>
          ) : (
            <div className="admin-cancel-confirm">
              <p role="status">تأكيد إلغاء الطلب؟ لا يمكن التراجع.</p>
              <button
                type="submit"
                name="nextStatus"
                value="cancelled"
                className="admin-button-danger"
                disabled={pending}
              >
                تأكيد الإلغاء
              </button>
              <button
                type="button"
                className="admin-button-secondary"
                onClick={() => setConfirmCancel(false)}
                disabled={pending}
              >
                تراجع
              </button>
            </div>
          )}
        </div>
      ) : null}

      {state?.message ? (
        <p className="admin-form-error" role="alert">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
