"use client";

import { useActionState } from "react";

import {
  archiveOfferAction,
  deleteOfferAction,
} from "@/features/offers/application/offer-actions";

export function OfferArchiveForm({
  offerId,
  archived,
}: {
  offerId: string;
  archived: boolean;
}) {
  const [state, action, pending] = useActionState(archiveOfferAction, null);
  return (
    <form action={action}>
      <input type="hidden" name="offerId" value={offerId} />
      <input type="hidden" name="archive" value={archived ? "0" : "1"} />
      <button type="submit" className="admin-btn" disabled={pending}>
        {archived ? "استعادة العرض (يعود غير مفعّل)" : "أرشفة العرض"}
      </button>
      {state ? (
        <p className="admin-form-error" role="alert">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

export function OfferDeleteForm({ offerId }: { offerId: string }) {
  const [state, action, pending] = useActionState(deleteOfferAction, null);
  return (
    <form action={action}>
      <input type="hidden" name="offerId" value={offerId} />
      <button
        type="submit"
        className="admin-btn admin-btn-danger"
        disabled={pending}
      >
        حذف العرض نهائياً
      </button>
      {state ? (
        <p className="admin-form-error" role="alert">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
