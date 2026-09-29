import type { Metadata } from "next";
import { connection } from "next/server";

import { adminNotificationService } from "@/features/admin/application/admin-services";
import { openNotificationAction } from "@/features/admin/application/admin-actions";
import { requireAdminSession } from "@/features/admin/auth/admin-session";
import { formatAdminDateTime } from "@/features/admin/ui/format-admin-datetime";
import { PushNotificationControl } from "@/features/admin/ui/push-notification-control";

export const metadata: Metadata = { title: "الإشعارات" };

export default async function AdminNotificationsPage() {
  await connection();
  const actor = await requireAdminSession();
  const notifications = await adminNotificationService.list(actor);

  return (
    <main className="admin-page">
      <header className="admin-page-header">
        <div>
          <h1>الإشعارات</h1>
          <p className="admin-lede">
            طلبات المتجر والتنبيهات المهمة في مكان واحد.
          </p>
        </div>
      </header>
      <section className="admin-panel admin-notification-setup">
        <h2>إشعارات هذا الهاتف</h2>
        <p className="admin-muted">
          فعّليها مرة واحدة ليصل تنبيه عند كل طلب جديد.
        </p>
        <PushNotificationControl />
      </section>
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
          <div className="admin-empty admin-empty-compact">
            لا توجد إشعارات بعد.
          </div>
        )}
      </section>
    </main>
  );
}
