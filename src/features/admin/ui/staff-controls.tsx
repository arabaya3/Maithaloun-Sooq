"use client";

import { useActionState } from "react";

import {
  revokeSessionAction,
  setOperatorActiveAction,
  type StaffActionResult,
} from "@/features/admin/application/staff-actions";

function Result({ state }: { state: StaffActionResult }) {
  return state ? (
    <p
      className={state.ok ? "admin-form-success" : "admin-form-error"}
      role={state.ok ? "status" : "alert"}
    >
      {state.message}
    </p>
  ) : null;
}

export function RevokeSessionButton({
  sessionId,
  label,
}: {
  sessionId: string;
  /** Names the device in the button so screen readers tell the rows apart. */
  label: string;
}) {
  const [state, action, pending] = useActionState(revokeSessionAction, null);
  return (
    <form action={action}>
      <input type="hidden" name="sessionId" value={sessionId} />
      <button
        type="submit"
        className="admin-btn admin-btn-secondary admin-btn-sm"
        aria-label={`إنهاء ${label}`}
        disabled={pending}
      >
        إنهاء الجلسة
      </button>
      <Result state={state} />
    </form>
  );
}

export function OperatorActiveToggle({
  userId,
  active,
  name,
}: {
  userId: string;
  active: boolean;
  name: string;
}) {
  const [state, action, pending] = useActionState(
    setOperatorActiveAction,
    null,
  );
  return (
    <form action={action}>
      <input type="hidden" name="userId" value={userId} />
      <input type="hidden" name="active" value={active ? "0" : "1"} />
      <button
        type="submit"
        className={
          active
            ? "admin-btn admin-btn-danger"
            : "admin-btn admin-btn-secondary"
        }
        disabled={pending}
      >
        {active ? `إيقاف حساب ${name}` : `تفعيل حساب ${name}`}
      </button>
      {active ? (
        <small className="admin-muted">
          {" "}
          الإيقاف يُخرجها من كل الأجهزة فوراً.
        </small>
      ) : null}
      <Result state={state} />
    </form>
  );
}
