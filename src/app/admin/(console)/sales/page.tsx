import type { Metadata } from "next";
import Link from "next/link";
import { ReceiptText } from "lucide-react";
import { connection } from "next/server";

import { salesService } from "@/features/admin/application/admin-services";
import { requireAdminSession } from "@/features/admin/auth/admin-session";
import { formatAdminDateTime } from "@/features/admin/ui/format-admin-datetime";
import {
  EmptyState,
  MetricCard,
  Money,
  PageHeader,
} from "@/features/admin/ui/kit";
import { formatIls } from "@/shared/lib/format-currency";
import { startOfStoreDay, todayInStoreZone } from "@/shared/lib/store-time";

function paymentChip(invoice: {
  status: string;
  totalAgorot: number;
  paidAtSaleAgorot: number;
}): { label: string; tone: "success" | "warning" | "neutral" } {
  if (invoice.status === "cancelled")
    return { label: "ملغاة", tone: "neutral" };
  if (invoice.paidAtSaleAgorot >= invoice.totalAgorot) {
    return { label: "مدفوعة نقداً", tone: "success" };
  }
  return invoice.paidAtSaleAgorot > 0
    ? { label: "جزء على الحساب", tone: "warning" }
    : { label: "على الحساب", tone: "warning" };
}

export const metadata: Metadata = { title: "المبيعات" };

export default async function SalesListPage() {
  await connection();
  const actor = await requireAdminSession();
  const [invoices, today] = await Promise.all([
    salesService.listInvoices(actor, 100),
    salesService.dayTotals(actor, startOfStoreDay(todayInStoreZone())),
  ]);

  return (
    <main className="admin-page admin-page--narrow admin-sales">
      <PageHeader title="المبيعات" lede="فواتير البيع المباشر في المحل." />
      <Link
        className="admin-btn admin-btn-primary admin-btn-block"
        href="/admin/sales/new"
        prefetch={false}
      >
        إدخال بيع يدوي
      </Link>
      <section
        className="admin-kpi-strip admin-kpi-strip--compact"
        aria-label="مبيعات اليوم"
      >
        <MetricCard label="فواتير اليوم" value={today.count} />
        <MetricCard label="مبيعات اليوم" value={formatIls(today.totalAgorot)} />
        <MetricCard
          label="حُصِّل عند البيع"
          value={formatIls(today.paidAtSaleAgorot)}
        />
        <MetricCard
          label="على الحساب"
          value={formatIls(today.onAccountAgorot)}
          tone={today.onAccountAgorot > 0 ? "warning" : "neutral"}
        />
      </section>
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
                    <span
                      className="admin-chip"
                      data-tone={paymentChip(invoice).tone}
                    >
                      {paymentChip(invoice).label}
                    </span>
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
