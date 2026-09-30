import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { purchaseService } from "@/features/admin/application/admin-services";
import { requireAdminSession } from "@/features/admin/auth/admin-session";
import { formatAdminDateTime } from "@/features/admin/ui/format-admin-datetime";
import { Money, PageHeader, Quantity } from "@/features/admin/ui/kit";
import {
  paymentStatusLabels,
  purchaseSourceLabels,
} from "@/features/purchasing/domain/purchase-constants";

export const metadata: Metadata = { title: "فاتورة شراء" };

export default async function PurchaseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await connection();
  const actor = await requireAdminSession();
  const invoice = await purchaseService.getDetail(actor, (await params).id);
  if (!invoice) notFound();

  return (
    <main className="admin-page admin-page--narrow">
      <PageHeader
        title={`فاتورة ${invoice.supplierName}`}
        lede={
          <>
            <bdi dir="ltr">{invoice.invoiceDate}</bdi>
            {invoice.reference ? (
              <>
                {" "}
                · رقم <bdi dir="ltr">{invoice.reference}</bdi>
              </>
            ) : null}
          </>
        }
        back={{ href: "/admin/inventory/purchases", label: "فواتير الشراء" }}
      />

      <section className="admin-panel" aria-labelledby="invoice-lines-title">
        <h2 id="invoice-lines-title">الأصناف</h2>
        <ul className="admin-line-list">
          {invoice.lines.map((line) => (
            <li key={line.lineNo} className="admin-line">
              <span className="admin-line-main">
                <strong>{line.name}</strong>
                <small>
                  <Quantity milli={line.quantityMilli} unit={line.unit} />
                  {line.packQuantity > 1 ? (
                    <>
                      {" "}
                      × <bdi dir="ltr">{line.packQuantity}</bdi> ={" "}
                      <Quantity milli={line.stockQuantityMilli} /> حبة
                    </>
                  ) : null}
                  {line.unitCostAgorot === null ? null : (
                    <>
                      {" "}
                      · سعر الوحدة <Money agorot={line.unitCostAgorot} />
                    </>
                  )}
                </small>
              </span>
              {line.lineTotalAgorot === null ? null : (
                <span className="admin-line-side">
                  <Money agorot={line.lineTotalAgorot} />
                </span>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="admin-panel" aria-labelledby="invoice-summary-title">
        <h2 id="invoice-summary-title">ملخص الفاتورة</h2>
        <dl className="admin-definition-list admin-totals">
          {invoice.subtotalAgorot === null ? null : (
            <>
              <dt>مجموع الأسطر</dt>
              <dd>
                <Money agorot={invoice.subtotalAgorot} />
              </dd>
            </>
          )}
          {invoice.discountAgorot ? (
            <>
              <dt>الخصم</dt>
              <dd>
                <Money agorot={-invoice.discountAgorot} />
              </dd>
            </>
          ) : null}
          {invoice.taxAgorot ? (
            <>
              <dt>الضريبة</dt>
              <dd>
                <Money agorot={invoice.taxAgorot} />
              </dd>
            </>
          ) : null}
          {invoice.totalAgorot === null ? null : (
            <>
              <dt>الإجمالي</dt>
              <dd>
                <Money agorot={invoice.totalAgorot} />
              </dd>
            </>
          )}
          <dt>الدفع عند التسجيل</dt>
          <dd>
            {paymentStatusLabels[invoice.paymentStatus]}
            {invoice.paidAgorot ? (
              <>
                {" "}
                (<Money agorot={invoice.paidAgorot} />)
              </>
            ) : null}
          </dd>
          <dt>طريقة الإدخال</dt>
          <dd>{purchaseSourceLabels[invoice.source]}</dd>
          <dt>سُجّلت بواسطة</dt>
          <dd>
            {invoice.createdByName} · {formatAdminDateTime(invoice.createdAt)}
          </dd>
          {invoice.notes ? (
            <>
              <dt>ملاحظات</dt>
              <dd>{invoice.notes}</dd>
            </>
          ) : null}
        </dl>
        {invoice.showCosts ? null : (
          <p className="admin-muted">المبالغ تظهر للمالك فقط.</p>
        )}
      </section>
    </main>
  );
}
