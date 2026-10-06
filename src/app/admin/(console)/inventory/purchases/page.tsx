import type { Metadata } from "next";
import Link from "next/link";
import {
  CheckCircle2,
  CircleDashed,
  Clock3,
  ReceiptText,
  ScanSearch,
  type LucideIcon,
} from "lucide-react";
import { connection } from "next/server";

import {
  extractionService,
  purchaseService,
} from "@/features/admin/application/admin-services";
import { requireAdminSession } from "@/features/admin/auth/admin-session";
import { formatAdminDateTime } from "@/features/admin/ui/format-admin-datetime";
import {
  EmptyState,
  Money,
  PageHeader,
  StatusPill,
  type PillTone,
} from "@/features/admin/ui/kit";
import {
  paymentStatusLabels,
  purchaseSourceLabels,
  type PurchasePaymentStatus,
} from "@/features/purchasing/domain/purchase-constants";

export const metadata: Metadata = { title: "فواتير الشراء" };

type Tab = "all" | "review" | PurchasePaymentStatus;

const tabs: { id: Tab; label: string }[] = [
  { id: "all", label: "الكل" },
  { id: "review", label: "بانتظار المراجعة" },
  { id: "unpaid", label: "غير مدفوعة" },
  { id: "partially_paid", label: "مدفوعة جزئياً" },
  { id: "paid", label: "مدفوعة" },
];

const paymentPill: Record<
  PurchasePaymentStatus,
  { tone: PillTone; Icon: LucideIcon }
> = {
  paid: { tone: "ok", Icon: CheckCircle2 },
  partially_paid: { tone: "warn", Icon: Clock3 },
  unpaid: { tone: "danger", Icon: CircleDashed },
};

export default async function PurchaseListPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  await connection();
  const actor = await requireAdminSession();
  const requested = (await searchParams).tab;
  const tab = tabs.find((item) => item.id === requested)?.id ?? "all";
  // Captures and spreadsheets wait as review jobs until confirmed; only confirmed ones become invoices.
  const [awaiting, invoices] = await Promise.all([
    extractionService.listAwaitingReview(actor),
    tab === "review"
      ? Promise.resolve([])
      : purchaseService.list(
          actor,
          100,
          tab === "all" ? {} : { paymentStatus: tab },
        ),
  ]);

  return (
    <main className="admin-page">
      <PageHeader
        title="فواتير الشراء"
        back={{ href: "/admin/inventory", label: "المخزون والمشتريات" }}
      />
      <Link
        className="admin-btn admin-btn-primary admin-btn-block"
        href="/admin/inventory/purchases/new"
        prefetch={false}
      >
        إدخال شراء يدوي
      </Link>

      <nav className="admin-tabs" aria-label="تصفية فواتير الشراء">
        {tabs.map((item) => (
          <Link
            key={item.id}
            href={
              item.id === "all"
                ? "/admin/inventory/purchases"
                : `/admin/inventory/purchases?tab=${item.id}`
            }
            prefetch={false}
            className={item.id === tab ? "admin-tab is-active" : "admin-tab"}
            aria-current={item.id === tab ? "page" : undefined}
          >
            {item.label}
            {item.id === "review" && awaiting.length
              ? ` (${awaiting.length})`
              : ""}
          </Link>
        ))}
      </nav>

      {tab === "review" ? (
        awaiting.length ? (
          <section className="admin-panel" aria-label="بانتظار المراجعة">
            <ul className="admin-line-list">
              {awaiting.map((job) => (
                <li key={job.id}>
                  <Link
                    href={`/admin/inventory/review/${job.id}`}
                    prefetch={false}
                    className="admin-line"
                  >
                    <span className="admin-line-main">
                      <strong>
                        {job.kind === "purchase_excel"
                          ? "ملف Excel لم يُؤكَّد بعد"
                          : "فاتورة مصوّرة لم تُؤكَّد بعد"}
                      </strong>
                      <small>{formatAdminDateTime(job.createdAt)}</small>
                    </span>
                    <span className="admin-line-side">
                      <StatusPill tone="info" Icon={ScanSearch}>
                        مسودة
                      </StatusPill>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : (
          <EmptyState Icon={ScanSearch} title="لا شيء بانتظار المراجعة">
            <p className="admin-muted">
              الفواتير المصوّرة وملفات Excel تظهر هنا حتى تؤكديها.
            </p>
          </EmptyState>
        )
      ) : invoices.length ? (
        <section className="admin-panel" aria-label="قائمة فواتير الشراء">
          <ul className="admin-line-list">
            {invoices.map((invoice) => {
              const pill = paymentPill[invoice.paymentStatus];
              return (
                <li key={invoice.id}>
                  <Link
                    href={`/admin/inventory/purchases/${invoice.id}`}
                    prefetch={false}
                    className="admin-line"
                  >
                    <span className="admin-line-main">
                      <strong>{invoice.supplierName}</strong>
                      <small>
                        <bdi dir="ltr">{invoice.invoiceDate}</bdi>
                        {invoice.reference ? (
                          <>
                            {" "}
                            · رقم <bdi dir="ltr">{invoice.reference}</bdi>
                          </>
                        ) : null}{" "}
                        · {invoice.lineCount} صنف ·{" "}
                        {purchaseSourceLabels[invoice.source]}
                      </small>
                    </span>
                    <span className="admin-line-side">
                      {invoice.totalAgorot === null ? null : (
                        <Money agorot={invoice.totalAgorot} />
                      )}
                      <StatusPill tone={pill.tone} Icon={pill.Icon}>
                        {paymentStatusLabels[invoice.paymentStatus]}
                      </StatusPill>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ) : tab === "all" ? (
        <EmptyState Icon={ReceiptText} title="لا توجد فواتير شراء بعد">
          <p className="admin-muted">
            كل فاتورة تُدخلينها تضيف الكميات إلى المخزون وتحفظ تكلفة الشراء.
          </p>
        </EmptyState>
      ) : (
        <EmptyState Icon={ReceiptText} title="لا توجد فواتير بهذه الحالة">
          <p className="admin-muted">جرّبي حالة أخرى.</p>
        </EmptyState>
      )}
    </main>
  );
}
