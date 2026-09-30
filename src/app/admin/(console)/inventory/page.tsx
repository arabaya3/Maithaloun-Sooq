import type { Metadata } from "next";
import Link from "next/link";
import {
  Camera,
  ClipboardList,
  FileSpreadsheet,
  PackageCheck,
  PenLine,
  SlidersHorizontal,
  TriangleAlert,
  Truck,
} from "lucide-react";
import { connection } from "next/server";

import {
  extractionService,
  inventoryService,
  purchaseService,
} from "@/features/admin/application/admin-services";
import { requireAdminSession } from "@/features/admin/auth/admin-session";
import { can } from "@/features/admin/domain/permissions";
import { formatAdminDateTime } from "@/features/admin/ui/format-admin-datetime";
import {
  EmptyState,
  Money,
  PageHeader,
  Quantity,
  StockStatusPill,
} from "@/features/admin/ui/kit";
import type { StockListItem } from "@/features/inventory/application/inventory-service";
import { paymentStatusLabels } from "@/features/purchasing/domain/purchase-constants";

export const metadata: Metadata = { title: "المخزون والمشتريات" };

function AttentionList({ items }: { items: StockListItem[] }) {
  return (
    <ul className="admin-line-list">
      {items.map((item) => (
        <li key={item.variantId}>
          <Link
            href={`/admin/inventory/stock/${item.variantId}`}
            prefetch={false}
            className="admin-line"
          >
            <span className="admin-line-main">
              <strong>{item.name}</strong>
              {item.variantLabel ? <small>{item.variantLabel}</small> : null}
            </span>
            <span className="admin-line-side">
              <Quantity milli={item.availableMilli} unit={item.unit} />
              <StockStatusPill status={item.status} />
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export default async function InventoryOverviewPage() {
  await connection();
  const actor = await requireAdminSession();
  const [overview, invoices, awaitingReview] = await Promise.all([
    inventoryService.getOverview(actor),
    purchaseService.list(actor, 5),
    extractionService.listAwaitingReview(actor),
  ]);
  const canAdjust = can(actor, "stock.adjust");
  const attention = [...overview.outOfStock, ...overview.lowStock];

  const actions = [
    {
      href: "/admin/inventory/capture",
      label: "تصوير فاتورة شراء",
      Icon: Camera,
      show: true,
    },
    {
      href: "/admin/inventory/purchases/new",
      label: "إدخال شراء يدوي",
      Icon: PenLine,
      show: true,
    },
    {
      href: "/admin/inventory/import",
      label: "رفع ملف Excel",
      Icon: FileSpreadsheet,
      show: can(actor, "purchase.import"),
    },
    {
      href: "/admin/inventory/stock?filter=tracked",
      label: "تعديل مخزون",
      Icon: SlidersHorizontal,
      show: canAdjust,
    },
    {
      href: "/admin/inventory/stock?filter=attention",
      label: "عرض النواقص",
      Icon: TriangleAlert,
      show: true,
    },
    {
      href: "/admin/inventory/suppliers",
      label: "الموردون",
      Icon: Truck,
      show: true,
    },
  ].filter((action) => action.show);

  return (
    <main className="admin-page">
      <PageHeader
        title="المخزون والمشتريات"
        lede={
          overview.inventoryValueAgorot === null ? (
            `${overview.trackedCount} صنف متتبَّع`
          ) : (
            <>
              قيمة المخزون <Money agorot={overview.inventoryValueAgorot} /> ·{" "}
              {overview.trackedCount} صنف متتبَّع
            </>
          )
        }
      />

      <nav className="admin-action-grid" aria-label="إجراءات المخزون">
        {actions.map((action) => (
          <Link key={action.href} href={action.href} prefetch={false}>
            <action.Icon size={22} aria-hidden="true" />
            <span>{action.label}</span>
          </Link>
        ))}
      </nav>

      {awaitingReview.length ? (
        <section className="admin-panel" aria-labelledby="review-queue-title">
          <div className="admin-panel-header">
            <h2 id="review-queue-title">
              بانتظار مراجعتك ({awaitingReview.length})
            </h2>
          </div>
          <ul className="admin-line-list">
            {awaitingReview.map((job) => (
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
                  <span className="admin-line-side">متابعة المراجعة</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="admin-panel" aria-labelledby="attention-title">
        <div className="admin-panel-header">
          <h2 id="attention-title">
            يحتاج إعادة طلب
            {overview.outCount + overview.lowCount > 0
              ? ` (${overview.outCount + overview.lowCount})`
              : ""}
          </h2>
          <Link href="/admin/inventory/stock?filter=attention" prefetch={false}>
            عرض الكل
          </Link>
        </div>
        {attention.length ? (
          <AttentionList items={attention} />
        ) : overview.trackedCount === 0 ? (
          <EmptyState Icon={PackageCheck} title="لم يبدأ تتبّع المخزون بعد">
            <p className="admin-muted">
              سجّلي أول فاتورة شراء ليظهر المخزون هنا تلقائياً.
            </p>
            <Link
              className="admin-btn admin-btn-primary"
              href="/admin/inventory/purchases/new"
              prefetch={false}
            >
              إدخال شراء يدوي
            </Link>
          </EmptyState>
        ) : (
          <p className="admin-empty">كل الأصناف المتتبَّعة متوفرة.</p>
        )}
      </section>

      <div className="admin-two-column">
        <section className="admin-panel" aria-labelledby="invoices-title">
          <div className="admin-panel-header">
            <h2 id="invoices-title">آخر فواتير الشراء</h2>
            <Link href="/admin/inventory/purchases" prefetch={false}>
              عرض الكل
            </Link>
          </div>
          {invoices.length ? (
            <ul className="admin-line-list">
              {invoices.map((invoice) => (
                <li key={invoice.id}>
                  <Link
                    href={`/admin/inventory/purchases/${invoice.id}`}
                    prefetch={false}
                    className="admin-line"
                  >
                    <span className="admin-line-main">
                      <strong>{invoice.supplierName}</strong>
                      <small>
                        <bdi dir="ltr">{invoice.invoiceDate}</bdi> ·{" "}
                        {invoice.lineCount} صنف ·{" "}
                        {paymentStatusLabels[invoice.paymentStatus]}
                      </small>
                    </span>
                    {invoice.totalAgorot === null ? null : (
                      <span className="admin-line-side">
                        <Money agorot={invoice.totalAgorot} />
                      </span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="admin-empty">لا توجد فواتير شراء بعد.</p>
          )}
        </section>

        <section className="admin-panel" aria-labelledby="receipts-title">
          <div className="admin-panel-header">
            <h2 id="receipts-title">وصل حديثاً</h2>
          </div>
          {overview.recentReceipts.length ? (
            <ul className="admin-line-list">
              {overview.recentReceipts.map((receipt, index) => (
                <li key={`${receipt.variantId}-${index}`}>
                  <Link
                    href={`/admin/inventory/stock/${receipt.variantId}`}
                    prefetch={false}
                    className="admin-line"
                  >
                    <span className="admin-line-main">
                      <strong>{receipt.name}</strong>
                      <small>{formatAdminDateTime(receipt.at)}</small>
                    </span>
                    <span className="admin-line-side">
                      <span>
                        +
                        <Quantity
                          milli={receipt.quantityMilli}
                          unit={receipt.unit}
                        />
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="admin-empty">لم تُستلم بضاعة بعد.</p>
          )}
        </section>
      </div>

      {overview.untrackedCount > 0 ? (
        <p className="admin-inline-note">
          <ClipboardList size={16} aria-hidden="true" />
          {overview.untrackedCount} صنف بدون تتبّع مخزون — يبدأ التتبّع عند أول
          شراء أو رصيد افتتاحي.{" "}
          <Link href="/admin/inventory/stock?filter=untracked" prefetch={false}>
            عرضها
          </Link>
        </p>
      ) : null}
    </main>
  );
}
