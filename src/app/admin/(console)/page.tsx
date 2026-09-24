import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";

import { adminDashboardService } from "@/features/admin/application/admin-services";
import { requireAdminSession } from "@/features/admin/auth/admin-session";
import { formatAdminDateTime } from "@/features/admin/ui/format-admin-datetime";
import {
  AdminNextActionLabel,
  AdminStatusBadge,
} from "@/features/admin/ui/admin-status-badge";
import { orderStatusLabels } from "@/features/orders/domain/order-status";
import { formatIls } from "@/shared/lib/format-currency";

export const metadata: Metadata = {
  title: "لوحة المتابعة",
};

export default async function AdminDashboardPage() {
  await connection();
  const actor = await requireAdminSession();
  const summary = await adminDashboardService.getSummary(actor);

  const metricCards = [
    {
      label: "طلبات جديدة",
      value: summary.orders.pending,
      href: "/admin/orders?status=pending",
    },
    {
      label: "قيد التجهيز",
      value: summary.orders.preparing,
      href: "/admin/orders?status=preparing",
    },
    {
      label: "خرج للتوصيل",
      value: summary.orders.out_for_delivery,
      href: "/admin/orders?status=out_for_delivery",
    },
    {
      label: "تم التسليم اليوم",
      value: summary.deliveredToday,
      href: "/admin/orders?status=delivered",
    },
    {
      label: "منتجات غير متاحة",
      value: summary.unavailableProducts,
      href: "/admin/products",
    },
  ];

  return (
    <main className="admin-page">
      <header className="admin-page-header">
        <div>
          <h1>لوحة المتابعة</h1>
          <p className="admin-lede">ملخص تشغيلي لطلبات ومنتجات سوق ميثلون.</p>
        </div>
        <Link
          className="admin-button-primary"
          href="/admin/orders"
          prefetch={false}
        >
          قائمة الطلبات
        </Link>
      </header>

      <section aria-labelledby="ops-metrics-title">
        <h2 id="ops-metrics-title" className="sr-only">
          مؤشرات سريعة
        </h2>
        <ul className="admin-metric-grid">
          {metricCards.map((card) => (
            <li key={card.label}>
              <Link href={card.href} prefetch={false}>
                <span>{card.label}</span>
                <strong>{card.value}</strong>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section
        className="admin-panel"
        aria-labelledby="actionable-orders-title"
      >
        <div className="admin-panel-header">
          <h2 id="actionable-orders-title">طلبات تحتاج إجراء</h2>
          <Link href="/admin/orders?status=pending" prefetch={false}>
            عرض الجديد
          </Link>
        </div>
        {summary.actionableOrders.length === 0 ? (
          <p className="admin-empty">
            لا توجد طلبات تحتاج إجراء الآن.{" "}
            <Link href="/admin/products/new" prefetch={false}>
              أضف منتجاً
            </Link>
          </p>
        ) : (
          <ul className="admin-order-feed">
            {summary.actionableOrders.map((order) => (
              <li key={order.publicReference}>
                <Link
                  href={`/admin/orders/${order.publicReference}`}
                  prefetch={false}
                  className="admin-order-row"
                >
                  <div className="admin-order-row-main">
                    <bdi dir="ltr">{order.publicReference}</bdi>
                    <time dateTime={order.createdAt}>
                      {formatAdminDateTime(order.createdAt)}
                    </time>
                  </div>
                  <div className="admin-order-row-meta">
                    <span>{order.customerName}</span>
                    <AdminStatusBadge status={order.status} />
                    <strong>
                      {order.finalTotalAgorot === null
                        ? "—"
                        : formatIls(order.finalTotalAgorot)}
                    </strong>
                  </div>
                  <p className="admin-order-row-action">
                    <AdminNextActionLabel status={order.status} />
                    <span aria-hidden="true"> ←</span>
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="admin-muted">
        مؤكّد حالياً: {summary.orders.confirmed} · {orderStatusLabels.cancelled}
        : {summary.orders.cancelled}
      </p>
    </main>
  );
}
