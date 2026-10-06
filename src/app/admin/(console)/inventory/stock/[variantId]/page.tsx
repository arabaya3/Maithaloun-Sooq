import type { Metadata } from "next";
import { SlidersHorizontal } from "lucide-react";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { inventoryService } from "@/features/admin/application/admin-services";
import { requireAdminSession } from "@/features/admin/auth/admin-session";
import { can } from "@/features/admin/domain/permissions";
import { FilterSheet } from "@/features/admin/ui/filter-sheet";
import { formatAdminDateTime } from "@/features/admin/ui/format-admin-datetime";
import {
  Money,
  PageHeader,
  Quantity,
  StockStatusPill,
} from "@/features/admin/ui/kit";
import { formatQuantity } from "@/features/inventory/domain/quantity";
import { stockMovementReasonLabels } from "@/features/inventory/domain/stock-constants";
import {
  ReorderThresholdForm,
  StockAdjustForm,
} from "@/features/inventory/ui/stock-adjust-form";
import { formatBasisPoints } from "@/shared/lib/money-math";

export const metadata: Metadata = { title: "تفاصيل المخزون" };

function signed(milli: number): string {
  return milli > 0 ? `+${formatQuantity(milli)}` : formatQuantity(milli);
}

export default async function StockDetailPage({
  params,
}: {
  params: Promise<{ variantId: string }>;
}) {
  await connection();
  const actor = await requireAdminSession();
  const detail = await inventoryService.getVariantStock(
    actor,
    (await params).variantId,
  );
  if (!detail) notFound();
  const { stock, movements } = detail;
  const showCosts = can(actor, "stock.costs");
  const canAdjust = can(actor, "stock.adjust");

  return (
    <main className="admin-page">
      <PageHeader
        title={stock.name}
        lede={stock.variantLabel ?? undefined}
        back={{ href: "/admin/inventory/stock", label: "قائمة المخزون" }}
        actions={<StockStatusPill status={stock.status} />}
      />

      <section className="admin-panel" aria-labelledby="balance-title">
        <h2 id="balance-title">الرصيد الحالي</h2>
        {stock.tracked ? (
          <dl className="admin-figures">
            <div>
              <dt>في المحل</dt>
              <dd>
                <Quantity milli={stock.onHandMilli} unit={stock.unit} />
              </dd>
            </div>
            <div>
              <dt>محجوز لطلبات</dt>
              <dd>
                <Quantity milli={stock.reservedMilli} />
              </dd>
            </div>
            <div>
              <dt>متوفر للبيع</dt>
              <dd>
                <Quantity milli={stock.availableMilli} />
              </dd>
            </div>
            <div>
              <dt>سعر البيع</dt>
              <dd>
                <Money agorot={stock.salePriceAgorot} />
              </dd>
            </div>
            {showCosts && stock.avgCostAgorot !== null ? (
              <div>
                <dt>متوسط التكلفة</dt>
                <dd>
                  <Money agorot={stock.avgCostAgorot} />
                </dd>
              </div>
            ) : null}
            {showCosts && stock.stockValueAgorot !== null ? (
              <div>
                <dt>قيمة المخزون</dt>
                <dd>
                  <Money agorot={stock.stockValueAgorot} />
                </dd>
              </div>
            ) : null}
            {showCosts && stock.unitProfitAgorot !== null ? (
              <div>
                <dt>هامش تقديري للوحدة</dt>
                <dd>
                  <Money agorot={stock.unitProfitAgorot} />
                  {stock.marginBasisPoints === null ? null : (
                    <small className="admin-muted">
                      {" "}
                      <bdi dir="ltr">
                        {formatBasisPoints(stock.marginBasisPoints)}
                      </bdi>
                    </small>
                  )}
                </dd>
              </div>
            ) : null}
          </dl>
        ) : (
          <p className="admin-muted">
            هذا الصنف غير متتبَّع بعد. يبدأ التتبّع عند أول فاتورة شراء أو رصيد
            افتتاحي، وبعدها تُحجز الكميات للطلبات تلقائياً.
          </p>
        )}
      </section>

      {canAdjust ? (
        <section className="admin-panel" aria-labelledby="adjust-title">
          <h2 id="adjust-title">
            {stock.tracked ? "تعديل مخزون" : "بدء التتبّع برصيد افتتاحي"}
          </h2>
          <FilterSheet
            title={stock.tracked ? "تعديل مخزون" : "بدء التتبّع برصيد افتتاحي"}
            label={
              stock.tracked ? "تعديل الكمية أو حد الطلب" : "إدخال رصيد افتتاحي"
            }
            icon={<SlidersHorizontal size={18} aria-hidden="true" />}
          >
            <StockAdjustForm
              variantId={stock.variantId}
              tracked={stock.tracked}
              unit={stock.unit}
              onHandMilli={stock.onHandMilli}
            />
            {stock.tracked ? (
              <ReorderThresholdForm
                variantId={stock.variantId}
                thresholdMilli={stock.reorderThresholdMilli}
              />
            ) : null}
          </FilterSheet>
        </section>
      ) : null}

      <section className="admin-panel" aria-labelledby="movements-title">
        <h2 id="movements-title">سجل الحركات</h2>
        {movements.length ? (
          <ol className="admin-line-list admin-movement-timeline">
            {movements.map((movement) => (
              <li key={movement.id} className="admin-line">
                <span className="admin-line-main">
                  <strong>{stockMovementReasonLabels[movement.reason]}</strong>
                  <small>
                    {movement.actorName} ·{" "}
                    {formatAdminDateTime(movement.createdAt)}
                    {movement.unitCostAgorot !== null ? (
                      <>
                        {" "}
                        · تكلفة الوحدة{" "}
                        <Money agorot={movement.unitCostAgorot} />
                      </>
                    ) : null}
                  </small>
                </span>
                <span className="admin-line-side">
                  <bdi dir="ltr" className="admin-num">
                    {movement.qtyDeltaMilli !== 0
                      ? signed(movement.qtyDeltaMilli)
                      : signed(movement.reservedDeltaMilli)}
                  </bdi>
                  <small className="admin-muted">
                    {movement.qtyDeltaMilli !== 0 ? (
                      <>
                        الرصيد{" "}
                        <bdi dir="ltr">
                          {formatQuantity(movement.onHandAfterMilli)}
                        </bdi>
                      </>
                    ) : (
                      "حجز"
                    )}
                  </small>
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="admin-empty">لا توجد حركات مخزون لهذا الصنف بعد.</p>
        )}
      </section>
    </main>
  );
}
