"use client";

import { AlertTriangle } from "lucide-react";
import { useActionState, useState } from "react";

import { Money } from "@/features/admin/ui/kit";
import { decidePriceReviewAction } from "@/features/inventory/application/inventory-actions";
import type { PriceReviewItem } from "@/features/inventory/application/price-review-service";
import { priceReviewAdviceLabels } from "@/features/inventory/domain/pricing";
import { formatBasisPoints } from "@/shared/lib/money-math";
import { formatAgorotAsIlsInput } from "@/shared/lib/parse-ils";

export function PriceReviewCard({ item }: { item: PriceReviewItem }) {
  const [state, action, pending] = useActionState(
    decidePriceReviewAction,
    null,
  );
  const [editing, setEditing] = useState(false);
  const { comparison } = item;

  return (
    <li className="admin-panel admin-price-review">
      <div className="admin-review-line-head">
        <strong>
          {item.name}
          {item.variantLabel ? ` — ${item.variantLabel}` : ""}
        </strong>
        {item.status === "later" ? (
          <small className="admin-muted">مؤجَّل</small>
        ) : null}
      </div>
      <dl className="admin-review-line-costs">
        <div>
          <dt>التكلفة السابقة</dt>
          <dd>
            {comparison.previousCostAgorot === null ? (
              "لا توجد"
            ) : (
              <Money agorot={comparison.previousCostAgorot} />
            )}
          </dd>
        </div>
        <div>
          <dt>التكلفة الجديدة</dt>
          <dd>
            <Money agorot={comparison.newCostAgorot} />
            {comparison.costChangeBasisPoints ? (
              <small>
                {" "}
                <bdi dir="ltr">
                  {comparison.costChangeBasisPoints > 0 ? "+" : ""}
                  {formatBasisPoints(comparison.costChangeBasisPoints)}
                </bdi>
              </small>
            ) : null}
          </dd>
        </div>
        <div>
          <dt>سعر البيع الحالي</dt>
          <dd>
            <Money agorot={comparison.salePriceAgorot} />
          </dd>
        </div>
        <div>
          <dt>ربح تقديري للوحدة</dt>
          <dd>
            <Money agorot={comparison.profitAgorot} />
            {comparison.marginBasisPoints === null ? null : (
              <small>
                {" "}
                <bdi dir="ltr">
                  {formatBasisPoints(comparison.marginBasisPoints)}
                </bdi>
              </small>
            )}
          </dd>
        </div>
      </dl>
      <p className="admin-review-line-advice">
        <AlertTriangle size={14} aria-hidden="true" />
        {priceReviewAdviceLabels[comparison.advice]}
      </p>

      <form action={action} className="admin-form">
        <input type="hidden" name="id" value={item.id} />
        {editing ? (
          <label>
            سعر البيع الجديد ₪
            <input
              name="newPrice"
              required
              inputMode="decimal"
              dir="ltr"
              defaultValue={formatAgorotAsIlsInput(comparison.salePriceAgorot)}
            />
          </label>
        ) : null}
        {state && !state.ok ? (
          <p className="admin-form-error" role="alert">
            {state.message}
          </p>
        ) : null}
        <div className="admin-form-actions">
          {/* Keys stop React from reusing a clicked button as the submit button. */}
          {editing ? (
            <>
              <button
                key="save"
                type="submit"
                name="decision"
                value="change"
                className="admin-btn admin-btn-primary"
                disabled={pending}
              >
                حفظ السعر الجديد
              </button>
              <button
                key="cancel"
                type="button"
                className="admin-btn admin-btn-secondary"
                onClick={() => setEditing(false)}
              >
                تراجع
              </button>
            </>
          ) : (
            <>
              <button
                key="edit"
                type="button"
                className="admin-btn admin-btn-primary"
                onClick={() => setEditing(true)}
              >
                تعديل سعر البيع
              </button>
              <button
                key="keep"
                type="submit"
                name="decision"
                value="keep"
                className="admin-btn admin-btn-secondary"
                disabled={pending}
              >
                إبقاء السعر
              </button>
              {item.status === "pending" ? (
                <button
                  type="submit"
                  name="decision"
                  value="later"
                  className="admin-btn admin-btn-ghost"
                  disabled={pending}
                >
                  لاحقاً
                </button>
              ) : null}
            </>
          )}
        </div>
      </form>
    </li>
  );
}
