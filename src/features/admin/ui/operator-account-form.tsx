"use client";

import { useActionState } from "react";

import { saveOperatorAction } from "@/features/admin/application/admin-actions";

export function OperatorAccountForm() {
  const [state, action, pending] = useActionState(saveOperatorAction, null);
  return (
    <form action={action} className="admin-form admin-operator-form">
      <div className="admin-field-grid">
        <label>
          اسم المستخدم
          <input
            name="username"
            required
            minLength={3}
            maxLength={32}
            dir="ltr"
            autoComplete="username"
          />
        </label>
        <label>
          اسم الموظفة
          <input
            name="displayName"
            required
            minLength={2}
            maxLength={80}
            autoComplete="name"
          />
        </label>
      </div>
      <label>
        كلمة مرور جديدة
        <input
          name="password"
          type="password"
          required
          minLength={12}
          maxLength={128}
          autoComplete="new-password"
        />
      </label>
      <p className="admin-muted">
        الحساب يستطيع إدارة المنتجات والطلبات، ولا يستطيع فتح إعدادات المالك.
      </p>
      {state ? (
        <p
          className={state.ok ? "admin-form-success" : "admin-form-error"}
          role="status"
        >
          {state.message}
        </p>
      ) : null}
      <button
        className="admin-btn admin-btn-primary"
        type="submit"
        disabled={pending}
      >
        {pending ? "جارٍ الحفظ…" : "حفظ حساب الموظفة"}
      </button>
    </form>
  );
}
