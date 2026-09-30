import { AlertTriangle, ArrowLeft } from "lucide-react";

import { Money, Quantity } from "@/features/admin/ui/kit";
import type { SalePreview } from "@/features/sales/application/sales-service";
import { formatBasisPoints } from "@/shared/lib/money-math";

export function SaleReviewCard({ preview }: { preview: SalePreview }) {
  const { totals } = preview;
  return (
    <div className="admin-review">
      <dl className="admin-definition-list">
        <dt>الزبون</dt>
        <dd>
          {preview.customerName ?? "بيع نقدي بدون اسم"}
          {preview.newCustomer ? (
            <small className="admin-muted"> (زبون جديد)</small>
          ) : null}
        </dd>
      </dl>

      <h3>المنتجات وأثرها على المخزون</h3>
      <ul className="admin-review-lines">
        {preview.lines.map((line) => (
          <li key={line.variantId}>
            <div className="admin-review-line-head">
              <strong>{line.name}</strong>
              <Money agorot={line.lineTotalAgorot} />
            </div>
            <p className="admin-review-line-stock">
              <Quantity milli={line.quantityMilli} unit={line.unit} /> ×{" "}
              <Money agorot={line.unitPriceAgorot} />
            </p>
            {line.tracked ? (
              <p className="admin-review-line-stock">
                المخزون: <Quantity milli={line.availableBeforeMilli ?? 0} />
                <ArrowLeft size={14} aria-label="يصبح" />
                <strong>
                  <Quantity milli={line.availableAfterMilli ?? 0} />
                </strong>
              </p>
            ) : (
              <p className="admin-muted">بدون تتبّع مخزون — لن تُخصم كمية.</p>
            )}
            {line.insufficient ? (
              <p className="admin-form-error" role="alert">
                <AlertTriangle size={14} aria-hidden="true" /> الكمية المتوفرة
                لا تكفي.
              </p>
            ) : null}
          </li>
        ))}
      </ul>

      <dl className="admin-definition-list admin-totals">
        {totals.discountAgorot > 0 ? (
          <>
            <dt>المجموع قبل الخصم</dt>
            <dd>
              <Money agorot={totals.subtotalAgorot} />
            </dd>
            <dt>الخصم</dt>
            <dd>
              <Money agorot={-totals.discountAgorot} />
            </dd>
          </>
        ) : null}
        <dt>الإجمالي</dt>
        <dd>
          <Money agorot={totals.totalAgorot} />
        </dd>
        <dt>المدفوع الآن</dt>
        <dd>
          <Money agorot={totals.paidAgorot} />
        </dd>
        <dt>الباقي على الزبون</dt>
        <dd>
          <Money agorot={totals.remainingAgorot} />
        </dd>
        {preview.balance ? (
          <>
            <dt>رصيد الزبون بعد العملية</dt>
            <dd>
              <Money agorot={preview.balance.afterAgorot} />
              {preview.balance.beforeAgorot !== preview.balance.afterAgorot ? (
                <small className="admin-muted">
                  {" "}
                  (كان <Money agorot={preview.balance.beforeAgorot} />)
                </small>
              ) : null}
            </dd>
          </>
        ) : null}
        {preview.profit ? (
          <>
            <dt>ربح تقديري</dt>
            <dd>
              <Money agorot={preview.profit.grossProfitAgorot} />
              {preview.profit.marginBasisPoints === null ? null : (
                <small className="admin-muted">
                  {" "}
                  <bdi dir="ltr">
                    {formatBasisPoints(preview.profit.marginBasisPoints)}
                  </bdi>
                </small>
              )}
              {preview.profit.complete ? null : (
                <small className="admin-muted">
                  {" "}
                  — غير مكتمل: بعض الأصناف بلا تكلفة مسجّلة
                </small>
              )}
            </dd>
          </>
        ) : null}
      </dl>
    </div>
  );
}
