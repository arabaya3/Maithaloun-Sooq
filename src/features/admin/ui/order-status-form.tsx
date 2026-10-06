"use client";

import { useActionState, useState } from "react";

import { updateOrderStatusAction } from "@/features/admin/application/admin-actions";
import {
  getAllowedTransitions,
  getPrimaryNextActionLabel,
  orderStatusLabels,
  type OrderStatus,
} from "@/features/orders/domain/order-status";
import type { StatusImpact } from "@/features/orders/domain/status-impact";

function ImpactNote({ impact, id }: { impact?: StatusImpact; id: string }) {
  if (!impact) return null;
  return (
    <div
      className="admin-impact"
      id={id}
      data-blocked={impact.blocked || undefined}
    >
      <p className="admin-impact-title">
        {impact.blocked ? "لا يمكن التأكيد الآن:" : "ماذا سيحدث عند التأكيد:"}
      </p>
      <ul>
        {impact.stock.map((line) => (
          <li key={line}>{line}</li>
        ))}
        <li>{impact.money}</li>
      </ul>
    </div>
  );
}

export function OrderStatusForm({
  publicReference,
  status,
  version,
  cancelOnly = false,
  impacts = {},
}: {
  publicReference: string;
  status: OrderStatus;
  version: number;
  // QA orders can only be closed; the server enforces the same rule.
  cancelOnly?: boolean;
  /** Stock and money effect of each allowed next status, computed on the server. */
  impacts?: Partial<Record<OrderStatus, StatusImpact>>;
}) {
  const transitions = getAllowedTransitions(status).filter(
    (value) => !cancelOnly || value === "cancelled",
  );
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
          <div key={nextStatus} className="admin-status-step">
            <ImpactNote
              impact={impacts[nextStatus]}
              id={`impact-${nextStatus}`}
            />
            <button
              type="submit"
              name="nextStatus"
              value={nextStatus}
              disabled={pending || impacts[nextStatus]?.blocked}
              aria-describedby={
                impacts[nextStatus] ? `impact-${nextStatus}` : undefined
              }
              className="admin-btn admin-btn-primary"
            >
              {getPrimaryNextActionLabel(status) ??
                `نقل إلى ${orderStatusLabels[nextStatus]}`}
            </button>
          </div>
        ))}
      </div>

      <label htmlFor="order-reason">سبب داخلي اختياري</label>
      <input id="order-reason" name="reason" maxLength={180} />

      {canCancel ? (
        <div className="admin-cancel-block">
          {!confirmCancel ? (
            <button
              type="button"
              className="admin-btn admin-btn-danger"
              onClick={() => setConfirmCancel(true)}
              disabled={pending}
            >
              إلغاء الطلب
            </button>
          ) : (
            <div className="admin-cancel-confirm">
              <p role="status">تأكيد إلغاء الطلب؟ لا يمكن التراجع.</p>
              <ImpactNote impact={impacts.cancelled} id="impact-cancelled" />
              <button
                type="submit"
                name="nextStatus"
                value="cancelled"
                className="admin-btn admin-btn-danger"
                disabled={pending}
              >
                تأكيد الإلغاء
              </button>
              <button
                type="button"
                className="admin-btn admin-btn-secondary"
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
