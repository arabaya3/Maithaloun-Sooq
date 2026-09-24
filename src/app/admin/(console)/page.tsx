import type { Metadata } from "next";
import Link from "next/link";
import {
  AlertTriangle,
  Bike,
  CheckCircle2,
  ClipboardList,
  PackagePlus,
  Sparkles,
  Truck,
} from "lucide-react";
import { connection } from "next/server";

import { adminDashboardService } from "@/features/admin/application/admin-services";
import { requireAdminSession } from "@/features/admin/auth/admin-session";
import { formatAdminDateTime } from "@/features/admin/ui/format-admin-datetime";
import {
  AdminNextActionLabel,
  AdminStatusBadge,
  formatAdminRelativeTime,
  shortenOrderReference,
} from "@/features/admin/ui/admin-status-badge";
import {
  FREE_DELIVERY_THRESHOLD_AGOROT,
  STANDARD_DELIVERY_FEE_AGOROT,
} from "@/features/delivery/delivery-policy";
import { orderStatusLabels } from "@/features/orders/domain/order-status";
import { formatIls } from "@/shared/lib/format-currency";

export const metadata: Metadata = {
  title: "لوحة المتابعة",
};

export default async function AdminDashboardPage() {
  await connection();
  const actor = await requireAdminSession();
  const summary = await adminDashboardService.getSummary(actor);
  const todayLabel = new Intl.DateTimeFormat("ar-PS-u-nu-latn", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date());

  const metrics = [
    {
      label: "طلبات جديدة",
      value: summary.orders.pending,
      href: "/admin/orders?status=pending",
      support: "بانتظار التأكيد",
      Icon: ClipboardList,
      tone: "warning" as const,
    },
    {
      label: "قيد التجهيز",
      value: summary.orders.preparing,
      href: "/admin/orders?status=preparing",
      support: "يتم تجهيزها الآن",
      Icon: PackagePlus,
      tone: "info" as const,
    },
    {
      label: "خرجت للتوصيل",
      value: summary.orders.out_for_delivery,
      href: "/admin/orders?status=out_for_delivery",
      support: "في الطريق للزبون",
      Icon: Bike,
      tone: "warm" as const,
    },
    {
      label: "تم تسليمها اليوم",
      value: summary.deliveredToday,
      href: "/admin/orders?status=delivered",
      support: "اكتملت اليوم",
      Icon: CheckCircle2,
      tone: "success" as const,
    },
  ];

  const attentionCount =
    summary.orders.pending +
    summary.orders.confirmed +
    summary.orders.preparing +
    summary.orders.out_for_delivery;

  return (
    <main className="admin-page">
      <header className="admin-page-header">
        <div>
          <h1>لوحة المتابعة</h1>
          <p className="admin-lede">
            {todayLabel}
            {attentionCount > 0
              ? ` · ${attentionCount} طلب يحتاج متابعة`
              : " · لا توجد طلبات معلّقة"}
          </p>
        </div>
        <div className="admin-page-header-actions">
          <Link
            className="admin-btn admin-btn-secondary"
            href="/admin/orders"
            prefetch={false}
          >
            عرض الطلبات
          </Link>
          <Link
            className="admin-btn admin-btn-primary"
            href="/admin/products/new"
            prefetch={false}
          >
            إضافة منتج
          </Link>
        </div>
      </header>

      <section aria-labelledby="ops-metrics-title">
        <h2 id="ops-metrics-title" className="sr-only">
          مؤشرات التشغيل
        </h2>
        <ul className="admin-metric-grid">
          {metrics.map((metric) => {
            const Icon = metric.Icon;
            return (
              <li key={metric.label}>
                <Link
                  href={metric.href}
                  prefetch={false}
                  className={`admin-metric-card admin-metric-card--${metric.tone}`}
                >
                  <span className="admin-metric-icon" aria-hidden="true">
                    <Icon size={18} />
                  </span>
                  <span className="admin-metric-label">{metric.label}</span>
                  <strong className="admin-metric-value">{metric.value}</strong>
                  <span className="admin-metric-support">{metric.support}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </section>

      <div className="admin-dashboard-grid">
        <section
          className="admin-panel admin-panel-main"
          aria-labelledby="actionable-orders-title"
        >
          <div className="admin-panel-header">
            <h2 id="actionable-orders-title">طلبات تحتاج إجراء</h2>
            <Link href="/admin/orders?status=pending" prefetch={false}>
              عرض الكل
            </Link>
          </div>

          {summary.actionableOrders.length === 0 ? (
            <div className="admin-empty admin-empty-compact">
              <Sparkles size={20} aria-hidden="true" />
              <p>العمل محدّث — لا توجد طلبات تحتاج إجراء الآن.</p>
              <Link href="/admin/products/new" prefetch={false}>
                أضف منتجاً جديداً
              </Link>
            </div>
          ) : (
            <div className="admin-table-wrap">
              <table className="admin-data-table admin-table-desktop">
                <thead>
                  <tr>
                    <th>الطلب</th>
                    <th>الزبون</th>
                    <th>الوقت</th>
                    <th>الإجمالي</th>
                    <th>الحالة</th>
                    <th>الإجراء</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.actionableOrders.map((order) => (
                    <tr key={order.publicReference}>
                      <td>
                        <Link
                          href={`/admin/orders/${order.publicReference}`}
                          prefetch={false}
                          title={order.publicReference}
                        >
                          <bdi dir="ltr">
                            {shortenOrderReference(order.publicReference)}
                          </bdi>
                        </Link>
                      </td>
                      <td>{order.customerName}</td>
                      <td>
                        <time dateTime={order.createdAt}>
                          {formatAdminRelativeTime(order.createdAt)}
                        </time>
                      </td>
                      <td className="admin-num">
                        {order.finalTotalAgorot === null
                          ? "—"
                          : formatIls(order.finalTotalAgorot)}
                      </td>
                      <td>
                        <AdminStatusBadge status={order.status} />
                      </td>
                      <td>
                        <Link
                          className="admin-btn admin-btn-primary admin-btn-sm"
                          href={`/admin/orders/${order.publicReference}`}
                          prefetch={false}
                        >
                          <AdminNextActionLabel status={order.status} />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <ul className="admin-order-cards">
                {summary.actionableOrders.map((order) => (
                  <li key={order.publicReference}>
                    <article className="admin-order-card">
                      <div className="admin-order-card-top">
                        <Link
                          href={`/admin/orders/${order.publicReference}`}
                          prefetch={false}
                          title={order.publicReference}
                        >
                          <bdi dir="ltr">
                            {shortenOrderReference(order.publicReference)}
                          </bdi>
                        </Link>
                        <AdminStatusBadge status={order.status} />
                      </div>
                      <p className="admin-order-card-customer">
                        {order.customerName}
                      </p>
                      <div className="admin-order-card-bottom">
                        <time dateTime={order.createdAt}>
                          {formatAdminDateTime(order.createdAt)}
                        </time>
                        <strong className="admin-num">
                          {order.finalTotalAgorot === null
                            ? "—"
                            : formatIls(order.finalTotalAgorot)}
                        </strong>
                      </div>
                      <Link
                        className="admin-btn admin-btn-primary admin-btn-sm"
                        href={`/admin/orders/${order.publicReference}`}
                        prefetch={false}
                      >
                        <AdminNextActionLabel status={order.status} />
                      </Link>
                    </article>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        <aside className="admin-dashboard-side" aria-label="لوحة جانبية">
          {summary.unavailableProducts > 0 ? (
            <section
              className="admin-panel admin-alert-panel"
              aria-labelledby="inventory-alert-title"
            >
              <h2 id="inventory-alert-title">تنبيه المخزون</h2>
              <p>
                <AlertTriangle size={16} aria-hidden="true" />{" "}
                {summary.unavailableProducts} منتج غير متاح حالياً.
              </p>
              <Link
                href="/admin/products?availability=unavailable"
                prefetch={false}
              >
                مراجعة المنتجات
              </Link>
            </section>
          ) : null}

          <section
            className="admin-panel"
            aria-labelledby="status-distribution-title"
          >
            <h2 id="status-distribution-title">توزيع الحالات</h2>
            <ul className="admin-status-distribution">
              {(
                [
                  "pending",
                  "confirmed",
                  "preparing",
                  "out_for_delivery",
                  "delivered",
                  "cancelled",
                ] as const
              ).map((status) => (
                <li key={status}>
                  <span>{orderStatusLabels[status]}</span>
                  <strong className="admin-num">
                    {summary.orders[status]}
                  </strong>
                </li>
              ))}
            </ul>
          </section>

          <section
            className="admin-panel"
            aria-labelledby="delivery-rule-title"
          >
            <h2 id="delivery-rule-title">قاعدة التوصيل</h2>
            <ul className="admin-definition-list admin-compact-list">
              <li>
                <span>المنطقة</span>
                <strong>ميثلون</strong>
              </li>
              <li>
                <span>مجاني من</span>
                <strong className="admin-num">
                  {formatIls(FREE_DELIVERY_THRESHOLD_AGOROT)}
                </strong>
              </li>
              <li>
                <span>أقل من الحد</span>
                <strong className="admin-num">
                  {formatIls(STANDARD_DELIVERY_FEE_AGOROT)}
                </strong>
              </li>
            </ul>
            <p className="admin-muted admin-inline-note">
              <Truck size={14} aria-hidden="true" /> القيم معتمدة من الخادم عند
              إنشاء الطلب.
            </p>
          </section>

          <section
            className="admin-panel"
            aria-labelledby="quick-actions-title"
          >
            <h2 id="quick-actions-title">إجراءات سريعة</h2>
            <div className="admin-quick-actions">
              <Link
                className="admin-btn admin-btn-secondary"
                href="/admin/orders?status=pending"
                prefetch={false}
              >
                الطلبات الجديدة
              </Link>
              <Link
                className="admin-btn admin-btn-secondary"
                href="/admin/products/new"
                prefetch={false}
              >
                إضافة منتج
              </Link>
              <Link
                className="admin-btn admin-btn-ghost"
                href="/admin/settings"
                prefetch={false}
              >
                إعدادات المتجر
              </Link>
            </div>
          </section>
        </aside>
      </div>
    </main>
  );
}
