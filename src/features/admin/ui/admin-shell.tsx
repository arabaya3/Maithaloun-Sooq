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
      <header className="admin-topbar">
        <p className="admin-brand">إدارة سوق ميثلون</p>
        <AdminNav displayName={displayName} />
      </header>
      <div className="admin-body">{children}</div>
    </div>
  );
}
