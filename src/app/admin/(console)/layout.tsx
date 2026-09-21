import { connection } from "next/server";

import { requireAdminSession } from "@/features/admin/auth/admin-session";
import { AdminShell } from "@/features/admin/ui/admin-shell";

export default async function AdminConsoleLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await connection();
  const actor = await requireAdminSession();
  return <AdminShell displayName={actor.displayName}>{children}</AdminShell>;
}
