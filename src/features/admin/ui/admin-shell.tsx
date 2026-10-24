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
  features = [],
  children,
}: {
  displayName: string;
  role: AdminRole;
  assistant?: boolean;
  features?: readonly string[];
  children: React.ReactNode;
}) {
  return (
    <div className="admin-app">
      <aside className="admin-sidebar" aria-label="التنقل الجانبي">
        <AdminBrand />
        <AdminDesktopNav
          displayName={displayName}
          role={role}
          features={features}
        />
      </aside>
      <div className="admin-main">
        <AdminMobileHeader role={role} />
        <AdminTopbar />
        <div className="admin-body">{children}</div>
      </div>
      <AdminBottomNav
        displayName={displayName}
        role={role}
        features={features}
      />
      {assistant ? <AssistantLauncher /> : null}
    </div>
  );
}
