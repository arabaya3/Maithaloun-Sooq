"use client";

import { useActionState } from "react";

import { loginAction } from "@/features/admin/application/admin-actions";
import {
  LOGIN_PASSWORD_MAX_LENGTH,
  LOGIN_USERNAME_MAX_LENGTH,
} from "@/features/admin/auth/login-policy";

const initialState = null as { ok: false; message: string } | null;

export function LoginForm({ nextPath }: { nextPath: string }) {
  const [state, formAction, pending] = useActionState(
    async (_previous: typeof initialState, formData: FormData) => {
      return loginAction(formData);
    },
    initialState,
  );

  return (
    <form className="admin-login-form" action={formAction} noValidate>
      <input type="hidden" name="next" value={nextPath} />
      <div className="admin-honeypot" aria-hidden="true" hidden>
        <label htmlFor="admin-website">الموقع</label>
        <input
          id="admin-website"
          name="website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
        />
      </div>
      <label htmlFor="admin-username">اسم المستخدم</label>
      <input
        id="admin-username"
        name="username"
        type="text"
        autoComplete="username"
        required
        maxLength={LOGIN_USERNAME_MAX_LENGTH}
        dir="ltr"
      />
      <label htmlFor="admin-password">كلمة المرور</label>
      <input
        id="admin-password"
        name="password"
        type="password"
        autoComplete="current-password"
        required
        maxLength={LOGIN_PASSWORD_MAX_LENGTH}
      />
      {state?.message ? (
        <p className="admin-form-error" role="alert">
          {state.message}
        </p>
      ) : null}
      <button type="submit" disabled={pending}>
        {pending ? "جارٍ التحقق…" : "دخول الإدارة"}
      </button>
    </form>
  );
}
