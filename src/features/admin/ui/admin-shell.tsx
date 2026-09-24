import { AdminNav } from "./admin-nav";

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
        <p className="admin-brand">إدارة سوق ميثلون</p>
        <div className="admin-sidebar-nav">
          <AdminNav displayName={displayName} variant="desktop" />
        </div>
      </aside>
      <div className="admin-main">
        <header className="admin-mobile-header">
          <p className="admin-brand">إدارة سوق ميثلون</p>
          <AdminNav displayName={displayName} variant="mobile" />
        </header>
        <div className="admin-body">{children}</div>
      </div>
    </div>
  );
}
