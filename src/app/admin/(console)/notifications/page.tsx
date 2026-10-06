import type { Metadata } from "next";
import Link from "next/link";
import { BellOff } from "lucide-react";
import { connection } from "next/server";

import { adminNotificationService } from "@/features/admin/application/admin-services";
import { openNotificationAction } from "@/features/admin/application/admin-actions";
import { markAllNotificationsReadAction } from "@/features/admin/application/staff-actions";
import { requireAdminSession } from "@/features/admin/auth/admin-session";
import { can } from "@/features/admin/domain/permissions";
import { notificationTypeLabels } from "@/features/admin/notifications/notification-service";
import { formatAdminDateTime } from "@/features/admin/ui/format-admin-datetime";
import { EmptyState, PageHeader } from "@/features/admin/ui/kit";
import { PushNotificationControl } from "@/features/admin/ui/push-notification-control";

export const metadata: Metadata = { title: "الإشعارات" };

export default async function AdminNotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  await connection();
  const actor = await requireAdminSession();
  // Summaries carry sales and profit, so their filter appears only for those who may see them.
  const types = Object.keys(notificationTypeLabels).filter(
    (type) => type !== "business_summary" || can(actor, "reports.view"),
  );
  const tabs = [
    { id: "all", label: "الكل" },
    { id: "unread", label: "غير المقروءة" },
    ...types.map((type) => ({
      id: type,
      label: notificationTypeLabels[type]!,
    })),
  ];
  const requested = (await searchParams).filter;
  const filter = tabs.find((tab) => tab.id === requested)?.id ?? "all";
  const [notifications, unread] = await Promise.all([
    adminNotificationService.list(
      actor,
      50,
      filter === "unread"
        ? { unreadOnly: true }
        : filter === "all"
          ? {}
          : { type: filter },
    ),
    adminNotificationService.unreadCount(actor),
  ]);

  return (
    <main className="admin-page">
      <PageHeader
        title="الإشعارات"
        lede="طلبات المتجر والتنبيهات المهمة في مكان واحد."
      />
      <section className="admin-panel admin-notification-setup">
        <h2>إشعارات هذا الهاتف</h2>
        <p className="admin-muted">
          فعّليها مرة واحدة ليصل تنبيه عند كل طلب جديد.
        </p>
        <PushNotificationControl />
      </section>
      <nav className="admin-tabs" aria-label="تصفية الإشعارات">
        {tabs.map((tab) => (
          <Link
            key={tab.id}
            href={
              tab.id === "all"
                ? "/admin/notifications"
                : `/admin/notifications?filter=${tab.id}`
            }
            prefetch={false}
            className={tab.id === filter ? "admin-tab is-active" : "admin-tab"}
            aria-current={tab.id === filter ? "page" : undefined}
          >
            {tab.label}
            {tab.id === "unread" && unread ? ` (${unread})` : ""}
          </Link>
        ))}
      </nav>
      {unread ? (
        <form action={markAllNotificationsReadAction}>
          <button type="submit" className="admin-btn admin-btn-secondary">
            تعليم الكل كمقروء
          </button>
        </form>
      ) : null}
      <section className="admin-notification-list" aria-label="آخر الإشعارات">
        {notifications.length ? (
          notifications.map((notification) => (
            <form key={notification.id} action={openNotificationAction}>
              <input
                type="hidden"
                name="notificationId"
                value={notification.id}
              />
              <button type="submit" className="admin-notification-item">
                <span
                  className={
                    notification.readAt
                      ? "admin-notification-dot is-read"
                      : "admin-notification-dot"
                  }
                  aria-label={notification.readAt ? undefined : "غير مقروء"}
                  role={notification.readAt ? undefined : "img"}
                />
                <span>
                  <strong>{notification.title}</strong>
                  <small>{notification.body}</small>
                </span>
                <time dateTime={notification.createdAt.toISOString()}>
                  {formatAdminDateTime(notification.createdAt.toISOString())}
                </time>
              </button>
            </form>
          ))
        ) : (
          <EmptyState
            Icon={BellOff}
            title={
              filter === "unread"
                ? "لا إشعارات غير مقروءة"
                : filter === "all"
                  ? "لا توجد إشعارات بعد"
                  : "لا إشعارات من هذا النوع"
            }
          >
            <p className="admin-muted">
              تصل هنا الطلبات الجديدة وتذكيرات الديون
              {can(actor, "reports.view") ? " والملخصات الدورية" : ""}.
            </p>
          </EmptyState>
        )}
      </section>
    </main>
  );
}
