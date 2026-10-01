import { connection } from "next/server";

import { requireAdminSession } from "@/features/admin/auth/admin-session";
import { AdminShell } from "@/features/admin/ui/admin-shell";
import {
  assistantMode,
  canUseAssistant,
} from "@/features/assistant/domain/assistant-policy";

export default async function AdminConsoleLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await connection();
  const actor = await requireAdminSession();
  return (
    <AdminShell
      displayName={actor.displayName}
      role={actor.role}
      assistant={canUseAssistant(
        actor,
        assistantMode(process.env.ADMIN_ASSISTANT),
      )}
    >
      {children}
    </AdminShell>
  );
}
