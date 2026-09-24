import { AdminBrand, AdminDesktopNav, AdminMobileNav } from "./admin-nav";
import { AdminTopbar } from "./admin-topbar";

export function AdminShell({
  displayName,
  children,
}: {
  displayName: string;
  children: React.ReactNode;
}) {
  return (
    <div className="admin-app">
      <aside className="admin-sidebar" aria-label="التنقل الجانبي">
        <AdminBrand />
        <AdminDesktopNav displayName={displayName} />
      </aside>
      <div className="admin-main">
        <header className="admin-mobile-header">
          <AdminBrand compact />
          <AdminMobileNav displayName={displayName} />
        </header>
        <AdminTopbar />
        <div className="admin-body">{children}</div>
      </div>
    </div>
  );
}
