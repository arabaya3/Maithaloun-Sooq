"use client";

import { useActionState } from "react";

import { saveStoreWhatsAppAction } from "../application/store-contact-actions";

export function StoreWhatsAppForm({ current }: { current: string | null }) {
  const [state, action, pending] = useActionState(
    saveStoreWhatsAppAction,
    null,
  );
  const country = current?.startsWith("+972") ? "972" : "970";
  const national = current ? `0${current.slice(4)}` : "";
  return (
    <form action={action} className="admin-form">
      <label>
        <span>مفتاح الدولة</span>
        <select name="countryCode" defaultValue={country}>
          <option value="970">+970</option>
          <option value="972">+972</option>
        </select>
      </label>
      <label>
        <span>رقم واتساب المتجر</span>
        <input
          name="nationalNumber"
          inputMode="tel"
          dir="ltr"
          autoComplete="off"
          placeholder="05XXXXXXXX"
          defaultValue={national}
        />
      </label>
      <p className="admin-muted">
        اتركيه فارغاً لإيقاف الطلب عبر واتساب. يرى الزبون هذا الرقم فقط بعد
        إرسال طلبه.
      </p>
      <button type="submit" className="admin-btn" disabled={pending}>
        حفظ الرقم
      </button>
      {state ? (
        <p
          className="admin-media-message"
          data-tone={state.ok ? "ok" : "error"}
          role={state.ok ? "status" : "alert"}
        >
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
