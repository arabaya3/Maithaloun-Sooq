"use client";

import { useActionState } from "react";

import { updateServiceAreaAction } from "@/features/admin/application/admin-actions";
import type { ServiceArea } from "@/features/delivery/service-area";
import { formatAgorotAsIlsInput } from "@/shared/lib/parse-ils";

export function DeliveryAreaForm({ area }: { area: ServiceArea }) {
  const [state, formAction, pending] = useActionState(
    async (
      _previous: { ok: false; message: string } | null,
      formData: FormData,
    ) => (await updateServiceAreaAction(formData)) ?? null,
    null,
  );
  const knownFee = area.deliveryFeeAgorot !== null;

  return (
    <form className="admin-form admin-area-form" action={formAction}>
      <input type="hidden" name="code" value={area.code} />
      <h2>{area.nameAr}</h2>
      <label htmlFor={`enabled-${area.code}`}>الحالة</label>
      <select
        id={`enabled-${area.code}`}
        name="enabled"
        defaultValue={area.enabled ? "true" : "false"}
      >
        <option value="true">مفعّلة</option>
        <option value="false">معطّلة</option>
      </select>
      <label htmlFor={`sort-${area.code}`}>ترتيب العرض</label>
      <input
        id={`sort-${area.code}`}
        name="sortOrder"
        type="number"
        min={0}
        required
        defaultValue={area.sortOrder}
      />
      <fieldset>
        <legend>تكلفة التوصيل</legend>
        <label>
          <input
            type="radio"
            name="feeMode"
            value="known"
            defaultChecked={knownFee}
          />
          مبلغ معروف
        </label>
        <label>
          <input
            type="radio"
            name="feeMode"
            value="unknown"
            defaultChecked={!knownFee}
          />
          غير معروفة
        </label>
        <label htmlFor={`fee-${area.code}`}>المبلغ بالشيكل</label>
        <input
          id={`fee-${area.code}`}
          name="deliveryFeeIls"
          inputMode="decimal"
          dir="ltr"
          defaultValue={
            knownFee
              ? formatAgorotAsIlsInput(area.deliveryFeeAgorot ?? 0)
              : "0.00"
          }
        />
        <p className="admin-muted">
          0 ₪ تعني توصيلاً مجانياً، وهي تختلف عن القيمة غير المعروفة.
        </p>
      </fieldset>
      {state?.message ? (
        <p className="admin-form-error" role="alert">
          {state.message}
        </p>
      ) : null}
      <button type="submit" disabled={pending}>
        {pending ? "جارٍ الحفظ…" : "حفظ المنطقة"}
      </button>
    </form>
  );
}
