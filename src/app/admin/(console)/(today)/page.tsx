import type { Metadata } from "next";
import Link from "next/link";
import {
  AlertTriangle,
  CalendarDays,
  ChartNoAxesColumn,
  ChevronLeft,
  ClipboardList,
  HandCoins,
  PackageMinus,
  PackageX,
  Plus,
  ReceiptText,
  ShoppingBag,
  Sparkles,
  Truck,
  Warehouse,
  type LucideIcon,
} from "lucide-react";
import { connection } from "next/server";
import { Suspense } from "react";

import { adminTodayService } from "@/features/admin/application/admin-services";
import type {
  TodayAlert,
  TodayTask,
} from "@/features/admin/application/admin-today-service";
import { PENDING_ALERT_MINUTES } from "@/features/admin/application/admin-today-service";
import { requireAdminSession } from "@/features/admin/auth/admin-session";
import type { AdminActor } from "@/features/admin/domain/admin-actor";
import { can } from "@/features/admin/domain/permissions";
import {
  AdminNextActionLabel,
  AdminStatusBadge,
  formatAdminRelativeTime,
  shortenOrderReference,
} from "@/features/admin/ui/admin-status-badge";
import { EmptyState, MetricCard, StickyAction } from "@/features/admin/ui/kit";
import { PushNotificationControl } from "@/features/admin/ui/push-notification-control";
import { AdminInstallAction } from "@/features/pwa/admin-install-action";
import { formatIls } from "@/shared/lib/format-currency";
import { STORE_TIME_ZONE } from "@/shared/lib/store-time";

export const metadata: Metadata = {
  title: "اليوم",
};

const timeFormat = new Intl.DateTimeFormat("ar-PS-u-nu-latn", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: true,
  timeZone: STORE_TIME_ZONE,
});

const taskIcons: Record<TodayTask["kind"], LucideIcon> = {
  order: ShoppingBag,
  sale: ReceiptText,
  purchase: Warehouse,
};

const alertCopy: Record<
  TodayAlert["id"],
  { Icon: LucideIcon; title: (count: number) => string; hint: string }
> = {
  pending_overdue: {
    Icon: AlertTriangle,
    title: (count) =>
      count === 1 ? "طلب جديد ينتظر التأكيد" : `${count} طلبات تنتظر التأكيد`,
    hint: `منذ أكثر من ${PENDING_ALERT_MINUTES} دقيقة`,
  },
  out_of_stock: {
    Icon: PackageX,
    title: (count) =>
      count === 1 ? "صنف نفد من المخزون" : `${count} أصناف نفدت من المخزون`,
    hint: "لا يمكن بيعها حتى تصل كمية جديدة",
  },
  low_stock: {
    Icon: PackageMinus,
    title: (count) =>
      count === 1 ? "صنف منخفض المخزون" : `${count} أصناف منخفضة المخزون`,
    hint: "حدّثي الكميات أو سجّلي شراءً قبل أن تنفد",
  },
  out_for_delivery: {
    Icon: Truck,
    title: (count) =>
      count === 1 ? "طلب في طريقه للزبون" : `${count} طلبات في طريقها للزبون`,
    hint: "أكّدي التسليم عند الوصول",
  },
};

async function MoneyCards({ actor }: { actor: AdminActor }) {
  const money = await adminTodayService.getMoney(actor);
  if (!money) return null;
  return (
    <>
      <MetricCard
        label="المبيعات اليوم"
        value={formatIls(money.netSalesAgorot)}
        support="صافي ما تم بيعه وتسليمه"
        href="/admin/reports"
      />
      <MetricCard
        label="الربح اليوم"
        value={formatIls(money.grossProfitAgorot)}
        support={
          money.costComplete
            ? "بعد خصم تكلفة البضاعة"
            : "تقديري: بعض الأصناف بلا تكلفة"
        }
        tone={money.costComplete ? "neutral" : "warning"}
        href="/admin/reports"
      />
    </>
  );
}

function AlertList({
  alerts,
  settled = false,
}: {
  alerts: TodayAlert[];
  settled?: boolean;
}) {
  if (!alerts.length) {
    return settled ? (
      <p className="admin-muted">لا توجد تنبيهات. كل شيء على ما يرام.</p>
    ) : null;
  }
  return (
    <ul className="admin-alert-list">
      {alerts.map((alert) => {
        const copy = alertCopy[alert.id];
        return (
          <li key={alert.id}>
            <Link
              href={alert.href}
              prefetch={false}
              className="admin-alert-item"
              data-tone={alert.tone}
            >
              <copy.Icon size={20} aria-hidden="true" />
              <span>
                <strong>{copy.title(alert.count)}</strong>
                <small>{copy.hint}</small>
              </span>
              <ChevronLeft size={18} aria-hidden="true" />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

// Order alerts are known at once; stock alerts read every tracked variant, so they follow.
async function AllAlerts({
  actor,
  orderAlerts,
}: {
  actor: AdminActor;
  orderAlerts: TodayAlert[];
}) {
  const stockAlerts = await adminTodayService.getStockAlerts(actor);
  const [overdue, ...rest] = orderAlerts;
  const ordered =
    overdue?.id === "pending_overdue"
      ? [overdue, ...stockAlerts, ...rest]
      : [...stockAlerts, ...orderAlerts];
  return <AlertList alerts={ordered} settled />;
}

export default async function AdminTodayPage() {
  await connection();
  const actor = await requireAdminSession();
  const today = await adminTodayService.getToday(actor);
  const dateLabel = new Intl.DateTimeFormat("ar-PS-u-nu-latn", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: STORE_TIME_ZONE,
  }).format(new Date());

  const quickActions = [
    can(actor, "sales.record")
      ? { href: "/admin/sales/new", label: "بيع سريع", Icon: HandCoins }
      : null,
    can(actor, "stock.view")
      ? {
          href: "/admin/inventory/stock",
          label: "تحديث المخزون",
          Icon: Warehouse,
        }
      : null,
    can(actor, "purchase.record")
      ? {
          href: "/admin/inventory/purchases/new",
          label: "تسجيل شراء",
          Icon: ReceiptText,
        }
      : null,
    can(actor, "reports.view")
      ? {
          href: "/admin/reports",
          label: "التقارير",
          Icon: ChartNoAxesColumn,
        }
      : null,
  ].filter((action) => action !== null);

  return (
    <main className="admin-page admin-today">
      <header className="admin-page-header">
        <div>
          <h1>اليوم</h1>
          <p className="admin-lede">
            {today.needsAction > 0
              ? `${today.needsAction} طلب يحتاج إجراء الآن`
              : "لا توجد طلبات تنتظر إجراء"}
          </p>
        </div>
      </header>

      <section className="admin-kpi-strip" aria-label="ملخص اليوم">
        <MetricCard
          label="اليوم"
          Icon={CalendarDays}
          value={<span className="admin-kpi-date">{dateLabel}</span>}
        />
        {can(actor, "reports.view") ? (
          <Suspense
            fallback={
              <>
                <MetricCard
                  label="المبيعات اليوم"
                  value={
                    <span className="admin-skeleton admin-skeleton-value" />
                  }
                  support="جارٍ الحساب…"
                />
                <MetricCard
                  label="الربح اليوم"
                  value={
                    <span className="admin-skeleton admin-skeleton-value" />
                  }
                  support="جارٍ الحساب…"
                />
              </>
            }
          >
            <MoneyCards actor={actor} />
          </Suspense>
        ) : null}
        <MetricCard
          label="طلبات اليوم"
          value={today.ordersToday}
          href="/admin/orders"
        />
        <MetricCard
          label="تحتاج إجراء"
          value={today.needsAction}
          tone={today.needsAction ? "warning" : "neutral"}
          href="/admin/orders?status=pending"
        />
      </section>

      <div className="admin-today-grid">
        <div className="admin-today-main">
          <section
            className="admin-today-card"
            aria-labelledby="needs-action-title"
          >
            <div className="admin-today-card-head">
              <h2 id="needs-action-title">تحتاج إجراء الآن</h2>
              <Link href="/admin/orders" prefetch={false}>
                كل الطلبات
              </Link>
            </div>
            {today.actionableOrders.length ? (
              <ul className="admin-action-list">
                {today.actionableOrders.map((order) => (
                  <li key={order.publicReference}>
                    <div className="admin-action-item">
                      <div className="admin-action-item-main">
                        <Link
                          href={`/admin/orders/${order.publicReference}`}
                          prefetch={false}
                          className="admin-action-item-title"
                          title={order.publicReference}
                        >
                          طلب{" "}
                          <bdi dir="ltr">
                            {shortenOrderReference(order.publicReference)}
                          </bdi>
                        </Link>
                        <p className="admin-muted">
                          <bdi>{order.customerName}</bdi> ·{" "}
                          <time dateTime={order.createdAt}>
                            {formatAdminRelativeTime(order.createdAt)}
                          </time>
                          {order.finalTotalAgorot === null
                            ? null
                            : ` · ${formatIls(order.finalTotalAgorot)}`}
                        </p>
                      </div>
                      <AdminStatusBadge status={order.status} />
                      <Link
                        className="admin-btn admin-btn-primary admin-btn-sm"
                        href={`/admin/orders/${order.publicReference}`}
                        prefetch={false}
                      >
                        <AdminNextActionLabel status={order.status} />
                      </Link>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState Icon={Sparkles} title="لا توجد طلبات تنتظرك">
                <p className="admin-muted">
                  الطلبات الجديدة تظهر هنا فور وصولها.
                </p>
              </EmptyState>
            )}
          </section>

          <section
            className="admin-today-card"
            aria-labelledby="timeline-title"
          >
            <div className="admin-today-card-head">
              <div>
                <h2 id="timeline-title">مهام اليوم</h2>
                <p className="admin-muted">
                  كل ما حدث في متجرك اليوم، بالترتيب الزمني
                </p>
              </div>
            </div>
            {today.tasks.length ? (
              <ol className="admin-timeline">
                {today.tasks.map((task) => {
                  const Icon = taskIcons[task.kind];
                  return (
                    <li key={task.id}>
                      <time dateTime={task.at} className="admin-timeline-time">
                        {timeFormat.format(new Date(task.at))}
                      </time>
                      <Link
                        href={task.href}
                        prefetch={false}
                        className="admin-timeline-item"
                      >
                        <span
                          className="admin-timeline-icon"
                          aria-hidden="true"
                        >
                          <Icon size={20} />
                        </span>
                        <span className="admin-timeline-text">
                          <strong>{task.title}</strong>
                          <bdi>{task.detail}</bdi>
                        </span>
                        <span
                          className="admin-chip"
                          data-tone={task.badge.tone}
                        >
                          {task.badge.label}
                        </span>
                        <ChevronLeft
                          size={18}
                          aria-hidden="true"
                          className="admin-timeline-chevron"
                        />
                      </Link>
                    </li>
                  );
                })}
              </ol>
            ) : (
              <EmptyState Icon={ClipboardList} title="لم يحدث شيء بعد اليوم">
                <p className="admin-muted">
                  الطلبات والمبيعات والمشتريات الجديدة تظهر هنا مع وقتها.
                </p>
              </EmptyState>
            )}
          </section>
        </div>

        <aside className="admin-today-side" aria-label="إجراءات وتنبيهات">
          <section
            className="admin-today-card"
            aria-labelledby="quick-actions-title"
          >
            <h2 id="quick-actions-title">إجراءات سريعة</h2>
            <StickyAction>
              <Link
                className="admin-btn admin-btn-primary admin-btn-block"
                href="/admin/products/new"
                prefetch={false}
              >
                <Plus size={20} aria-hidden="true" />
                إضافة منتج
              </Link>
            </StickyAction>
            <ul className="admin-quick-list">
              {quickActions.map((action) => (
                <li key={action.href}>
                  <Link href={action.href} prefetch={false}>
                    <action.Icon size={20} aria-hidden="true" />
                    <span>{action.label}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>

          <section className="admin-today-card" aria-labelledby="alerts-title">
            <h2 id="alerts-title">تنبيهات مهمة</h2>
            <Suspense fallback={<AlertList alerts={today.alerts} />}>
              <AllAlerts actor={actor} orderAlerts={today.alerts} />
            </Suspense>
          </section>

          <section className="admin-today-card" aria-labelledby="device-title">
            <h2 id="device-title">هذا الجهاز</h2>
            <AdminInstallAction />
            <PushNotificationControl />
          </section>
        </aside>
      </div>
    </main>
  );
}
