import type { Metadata } from "next";
import Link from "next/link";
import { Ban, MessageCircle } from "lucide-react";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { salesService } from "@/features/admin/application/admin-services";
import { requireAdminSession } from "@/features/admin/auth/admin-session";
import { can } from "@/features/admin/domain/permissions";
import { formatAdminDateTime } from "@/features/admin/ui/format-admin-datetime";
import {
  Money,
  PageHeader,
  Quantity,
  StatusPill,
} from "@/features/admin/ui/kit";
import {
  buildInvoiceShareText,
  buildWhatsAppShareUrl,
} from "@/features/sales/domain/invoice-share";
import { CancelInvoiceForm } from "@/features/sales/ui/customer-forms";
import { PrintButton } from "@/features/sales/ui/print-button";
import { formatBasisPoints } from "@/shared/lib/money-math";
import { toStoreDate } from "@/shared/lib/store-time";

export const metadata: Metadata = { title: "فاتورة بيع" };

export default async function SaleInvoicePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await connection();
  const actor = await requireAdminSession();
  const invoice = await salesService.getInvoice(actor, (await params).id);
  if (!invoice) notFound();
  const remaining = invoice.totalAgorot - invoice.paidAtSaleAgorot;
  const shareUrl = buildWhatsAppShareUrl(
    buildInvoiceShareText({
      ...invoice,
      date: toStoreDate(new Date(invoice.createdAt)),
    }),
    invoice.customerPhone,
  );

  return (
    <main className="admin-page admin-page--narrow admin-print-page">
      <PageHeader
        title={`فاتورة رقم ${invoice.invoiceNumber}`}
        lede={formatAdminDateTime(invoice.createdAt)}
        back={{ href: "/admin/sales", label: "المبيعات" }}
        actions={
          invoice.status === "cancelled" ? (
            <StatusPill tone="neutral" Icon={Ban}>
              ملغاة
            </StatusPill>
          ) : undefined
        }
      />

      <section className="admin-panel admin-invoice" aria-label="الفاتورة">
        <p className="admin-invoice-brand">سوق ميثلون</p>
        <dl className="admin-definition-list">
          <dt>الزبون</dt>
          <dd>
            {invoice.customerId && invoice.customerName ? (
              <Link
                href={`/admin/customers/${invoice.customerId}`}
                prefetch={false}
              >
                {invoice.customerName}
              </Link>
            ) : (
              "بيع نقدي"
            )}
          </dd>
        </dl>
        <ul className="admin-line-list">
          {invoice.lines.map((line) => (
            <li key={line.lineNo} className="admin-line">
              <span className="admin-line-main">
                <strong>{line.name}</strong>
                <small>
                  <Quantity milli={line.quantityMilli} unit={line.unit} /> ×{" "}
                  <Money agorot={line.unitPriceAgorot} />
                </small>
              </span>
              <span className="admin-line-side">
                <Money agorot={line.lineTotalAgorot} />
              </span>
            </li>
          ))}
        </ul>
        <dl className="admin-definition-list admin-totals">
          {invoice.discountAgorot > 0 ? (
            <>
              <dt>الخصم</dt>
              <dd>
                <Money agorot={-invoice.discountAgorot} />
              </dd>
            </>
          ) : null}
          <dt>الإجمالي</dt>
          <dd>
            <Money agorot={invoice.totalAgorot} />
          </dd>
          <dt>المدفوع عند البيع</dt>
          <dd>
            <Money agorot={invoice.paidAtSaleAgorot} />
          </dd>
          {remaining > 0 ? (
            <>
              <dt>الباقي على الحساب</dt>
              <dd>
                <Money agorot={remaining} />
              </dd>
            </>
          ) : null}
        </dl>
        {invoice.note ? <p className="admin-muted">{invoice.note}</p> : null}
        {invoice.cancelReason ? (
          <p className="admin-form-warning">
            سبب الإلغاء: {invoice.cancelReason}
          </p>
        ) : null}
      </section>

      {invoice.profit ? (
        <section className="admin-panel admin-no-print" aria-label="الربح">
          <dl className="admin-definition-list">
            <dt>تكلفة البضاعة المباعة</dt>
            <dd>
              <Money agorot={invoice.profit.cogsAgorot} />
            </dd>
            <dt>الربح الإجمالي</dt>
            <dd>
              <Money agorot={invoice.profit.grossProfitAgorot} />
              {invoice.profit.marginBasisPoints === null ? null : (
                <small className="admin-muted">
                  {" "}
                  <bdi dir="ltr">
                    {formatBasisPoints(invoice.profit.marginBasisPoints)}
                  </bdi>
                </small>
              )}
            </dd>
          </dl>
          {invoice.profit.complete ? null : (
            <p className="admin-muted">
              غير مكتمل: بعض الأصناف بيعت دون تكلفة مسجّلة، فلم تدخل في الربح.
            </p>
          )}
        </section>
      ) : null}

      <div className="admin-form-actions admin-no-print">
        <PrintButton />
        <a
          className="admin-btn admin-btn-secondary"
          href={shareUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          <MessageCircle size={18} aria-hidden="true" />
          مشاركة عبر واتساب
        </a>
      </div>

      {invoice.status === "posted" && can(actor, "ledger.correct") ? (
        <section className="admin-panel admin-no-print" aria-label="تصحيح">
          <p className="admin-muted">
            الإلغاء لا يحذف الفاتورة: يُسجَّل قيد عكسي وتعود البضاعة إلى
            المخزون.
          </p>
          <CancelInvoiceForm
            invoiceId={invoice.id}
            customerId={invoice.customerId}
          />
        </section>
      ) : null}
    </main>
  );
}
