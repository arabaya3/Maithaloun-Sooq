import Link from "next/link";
import { Bell } from "lucide-react";

import type { AdminRole } from "@/features/admin/domain/admin-actor";
import { AssistantLauncher } from "@/features/assistant/ui/assistant-launcher";

import { AdminBottomNav, AdminBrand, AdminDesktopNav } from "./admin-nav";
import { AdminTopbar } from "./admin-topbar";

export function AdminShell({
  displayName,
  role,
  assistant = false,
  children,
}: {
  displayName: string;
  role: AdminRole;
  assistant?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="admin-app">
      <aside className="admin-sidebar" aria-label="التنقل الجانبي">
        <AdminBrand />
        <AdminDesktopNav displayName={displayName} role={role} />
      </aside>
      <div className="admin-main">
        <header className="admin-mobile-header">
          <AdminBrand compact />
          <Link
            href="/admin/notifications"
            prefetch={false}
            className="admin-mobile-header-action"
            aria-label="الإشعارات"
          >
            <Bell size={20} aria-hidden="true" />
          </Link>
        </header>
        <AdminTopbar />
        <div className="admin-body">{children}</div>
      </div>
      <AdminBottomNav displayName={displayName} role={role} />
      {assistant ? <AssistantLauncher /> : null}
    </div>
  );
}
