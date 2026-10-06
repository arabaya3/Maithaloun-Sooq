import type { AdminRole } from "@/features/admin/domain/admin-actor";
import { AssistantLauncher } from "@/features/assistant/ui/assistant-launcher";

import {
  AdminBottomNav,
  AdminBrand,
  AdminDesktopNav,
  AdminMobileHeader,
} from "./admin-nav";
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
        <AdminMobileHeader role={role} />
        <AdminTopbar />
        <div className="admin-body">{children}</div>
      </div>
      <AdminBottomNav displayName={displayName} role={role} />
      {assistant ? <AssistantLauncher /> : null}
    </div>
  );
}
