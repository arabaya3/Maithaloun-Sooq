import type { Metadata } from "next";
import Link from "next/link";
import { Ban, ReceiptText } from "lucide-react";
import { connection } from "next/server";

import { salesService } from "@/features/admin/application/admin-services";
import { requireAdminSession } from "@/features/admin/auth/admin-session";
import { formatAdminDateTime } from "@/features/admin/ui/format-admin-datetime";
import {
  EmptyState,
  Money,
  PageHeader,
  StatusPill,
} from "@/features/admin/ui/kit";

export const metadata: Metadata = { title: "المبيعات" };

export default async function SalesListPage() {
  await connection();
  const actor = await requireAdminSession();
  const invoices = await salesService.listInvoices(actor, 100);

  return (
    <main className="admin-page admin-page--narrow">
      <PageHeader title="المبيعات" lede="فواتير البيع المباشر في المحل." />
      <Link
        className="admin-btn admin-btn-primary admin-btn-block"
        href="/admin/sales/new"
        prefetch={false}
      >
        إدخال بيع يدوي
      </Link>
      {invoices.length ? (
        <section className="admin-panel" aria-label="قائمة فواتير البيع">
          <ul className="admin-line-list">
            {invoices.map((invoice) => (
              <li key={invoice.id}>
                <Link
                  href={`/admin/sales/${invoice.id}`}
                  prefetch={false}
                  className="admin-line"
                >
                  <span className="admin-line-main">
                    <strong>{invoice.customerName ?? "بيع نقدي"}</strong>
                    <small>
                      رقم <bdi dir="ltr">{invoice.invoiceNumber}</bdi> ·{" "}
                      {formatAdminDateTime(invoice.createdAt)}
                      {invoice.source === "voice" ? " · بالصوت" : ""}
                    </small>
                  </span>
                  <span className="admin-line-side">
                    <Money agorot={invoice.totalAgorot} />
                    {invoice.status === "cancelled" ? (
                      <StatusPill tone="neutral" Icon={Ban}>
                        ملغاة
                      </StatusPill>
                    ) : invoice.paidAtSaleAgorot < invoice.totalAgorot ? (
                      <small className="admin-muted">على الحساب</small>
                    ) : null}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <EmptyState Icon={ReceiptText} title="لا توجد مبيعات مسجّلة بعد">
          <p className="admin-muted">
            سجّلي البيع يدوياً أو بالصوت ليُخصم من المخزون ويُحسب الربح.
          </p>
        </EmptyState>
      )}
    </main>
  );
}
