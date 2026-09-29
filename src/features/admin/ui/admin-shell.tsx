import { AdminBrand, AdminDesktopNav, AdminMobileNav } from "./admin-nav";
import { AdminTopbar } from "./admin-topbar";
import type { AdminRole } from "@/features/admin/domain/admin-actor";

export function AdminShell({
  displayName,
  role,
  children,
}: {
  displayName: string;
  role: AdminRole;
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
          <AdminMobileNav displayName={displayName} role={role} />
        </header>
        <AdminTopbar />
        <div className="admin-body">{children}</div>
      </div>
    </div>
  );
}
