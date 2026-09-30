import { AlertTriangle, ArrowLeft, CopyCheck } from "lucide-react";

import { Money, Quantity } from "@/features/admin/ui/kit";
import { priceReviewAdviceLabels } from "@/features/inventory/domain/pricing";
import type {
  PurchaseLineImpact,
  PurchasePreview,
} from "@/features/purchasing/application/purchase-service";
import { paymentStatusLabels } from "@/features/purchasing/domain/purchase-constants";
import { formatBasisPoints } from "@/shared/lib/money-math";

export function PurchaseLineImpacts({
  lines,
}: {
  lines: readonly PurchaseLineImpact[];
}) {
  return (
    <ul className="admin-review-lines">
      {lines.map((line, index) => (
        <li key={`${line.variantId}-${index}`}>
          <div className="admin-review-line-head">
            <strong>{line.name}</strong>
            <Money agorot={line.lineTotalAgorot} />
          </div>
          <p className="admin-review-line-stock">
            المخزون:{" "}
            <Quantity milli={line.onHandBeforeMilli} unit={line.stockUnit} />
            <ArrowLeft size={14} aria-label="يصبح" />
            <strong>
              <Quantity milli={line.onHandAfterMilli} unit={line.stockUnit} />
            </strong>
            {line.tracked ? null : (
              <span className="admin-muted"> (يبدأ تتبّع هذا الصنف)</span>
            )}
          </p>
          {line.comparison ? (
            <dl className="admin-review-line-costs">
              <div>
                <dt>التكلفة السابقة</dt>
                <dd>
                  {line.comparison.previousCostAgorot === null ? (
                    "لا توجد"
                  ) : (
                    <Money agorot={line.comparison.previousCostAgorot} />
                  )}
                </dd>
              </div>
              <div>
                <dt>التكلفة الجديدة</dt>
                <dd>
                  <Money agorot={line.comparison.newCostAgorot} />
                  {line.comparison.costChangeBasisPoints ? (
                    <small>
                      {" "}
                      <bdi dir="ltr">
                        {line.comparison.costChangeBasisPoints > 0 ? "+" : ""}
                        {formatBasisPoints(
                          line.comparison.costChangeBasisPoints,
                        )}
                      </bdi>
                    </small>
                  ) : null}
                </dd>
              </div>
              <div>
                <dt>سعر البيع</dt>
                <dd>
                  <Money agorot={line.comparison.salePriceAgorot} />
                </dd>
              </div>
              <div>
                <dt>ربح تقديري للوحدة</dt>
                <dd>
                  <Money agorot={line.comparison.profitAgorot} />
                  {line.comparison.marginBasisPoints === null ? null : (
                    <small>
                      {" "}
                      <bdi dir="ltr">
                        {formatBasisPoints(line.comparison.marginBasisPoints)}
                      </bdi>
                    </small>
                  )}
                </dd>
              </div>
            </dl>
          ) : null}
          {line.comparison && line.comparison.advice !== "ok" ? (
            <p className="admin-review-line-advice">
              <AlertTriangle size={14} aria-hidden="true" />
              {priceReviewAdviceLabels[line.comparison.advice]}
            </p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

export function PurchaseReviewSummary({
  preview,
  supplierName,
  reference,
  invoiceDate,
}: {
  preview: PurchasePreview;
  supplierName: string;
  reference: string;
  invoiceDate: string;
}) {
  const { totals } = preview;
  return (
    <div className="admin-review">
      {preview.duplicate === "exact" ? (
        <p className="admin-form-error" role="alert">
          <CopyCheck size={16} aria-hidden="true" /> هذه الفاتورة مسجّلة مسبقاً
          لنفس المورد ولن تُحفظ مرة ثانية.
        </p>
      ) : null}
      {preview.printedDifferenceAgorot ? (
        <p className="admin-form-warning" role="alert">
          <AlertTriangle size={16} aria-hidden="true" /> المجموع المحسوب يختلف
          عن المطبوع في الفاتورة بمقدار{" "}
          <Money agorot={Math.abs(preview.printedDifferenceAgorot)} />. راجعي
          الأسطر قبل الحفظ.
        </p>
      ) : null}

      <dl className="admin-definition-list">
        <dt>المورد</dt>
        <dd>{supplierName}</dd>
        {reference ? (
          <>
            <dt>رقم الفاتورة</dt>
            <dd>
              <bdi dir="ltr">{reference}</bdi>
            </dd>
          </>
        ) : null}
        <dt>التاريخ</dt>
        <dd>
          <bdi dir="ltr">{invoiceDate}</bdi>
        </dd>
      </dl>

      <h3>الأصناف وأثرها على المخزون</h3>
      <PurchaseLineImpacts lines={preview.lines} />

      <dl className="admin-definition-list admin-totals">
        <dt>مجموع الأسطر</dt>
        <dd>
          <Money agorot={totals.subtotalAgorot} />
        </dd>
        {totals.discountAgorot > 0 ? (
          <>
            <dt>الخصم</dt>
            <dd>
              <Money agorot={-totals.discountAgorot} />
            </dd>
          </>
        ) : null}
        {totals.taxAgorot ? (
          <>
            <dt>الضريبة</dt>
            <dd>
              <Money agorot={totals.taxAgorot} />
            </dd>
          </>
        ) : null}
        <dt>إجمالي الفاتورة</dt>
        <dd>
          <Money agorot={totals.totalAgorot} />
        </dd>
        <dt>الدفع</dt>
        <dd>{paymentStatusLabels[preview.paymentStatus]}</dd>
        {preview.supplierBalance ? (
          <>
            <dt>المستحق للمورد بعد الحفظ</dt>
            <dd>
              <Money agorot={preview.supplierBalance.afterAgorot} />
              {preview.supplierBalance.beforeAgorot !==
              preview.supplierBalance.afterAgorot ? (
                <small className="admin-muted">
                  {" "}
                  (كان <Money agorot={preview.supplierBalance.beforeAgorot} />)
                </small>
              ) : null}
            </dd>
          </>
        ) : null}
      </dl>
    </div>
  );
}
