import type { Metadata } from "next";
import Link from "next/link";
import { ReceiptText } from "lucide-react";
import { connection } from "next/server";

import { purchaseService } from "@/features/admin/application/admin-services";
import { requireAdminSession } from "@/features/admin/auth/admin-session";
import { EmptyState, Money, PageHeader } from "@/features/admin/ui/kit";
import {
  paymentStatusLabels,
  purchaseSourceLabels,
} from "@/features/purchasing/domain/purchase-constants";

export const metadata: Metadata = { title: "فواتير الشراء" };

export default async function PurchaseListPage() {
  await connection();
  const actor = await requireAdminSession();
  const invoices = await purchaseService.list(actor, 100);

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
      {invoices.length ? (
        <section className="admin-panel" aria-label="قائمة فواتير الشراء">
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
                    <small className="admin-muted">
                      {paymentStatusLabels[invoice.paymentStatus]}
                    </small>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <EmptyState Icon={ReceiptText} title="لا توجد فواتير شراء بعد">
          <p className="admin-muted">
            كل فاتورة تُدخلينها تضيف الكميات إلى المخزون وتحفظ تكلفة الشراء.
          </p>
        </EmptyState>
      )}
    </main>
  );
}
