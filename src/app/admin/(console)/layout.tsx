import { connection } from "next/server";

import { requireAdminSession } from "@/features/admin/auth/admin-session";
import { AdminCategoriesProvider } from "@/features/admin/ui/admin-categories";
import { AdminShell } from "@/features/admin/ui/admin-shell";
import {
  assistantMode,
  canUseAssistant,
} from "@/features/assistant/domain/assistant-policy";
import { assignableCategories } from "@/features/catalog/infrastructure/category-repository";

export default async function AdminConsoleLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await connection();
  const actor = await requireAdminSession();
  const categories = await assignableCategories();
  return (
    <AdminShell
      displayName={actor.displayName}
      role={actor.role}
      assistant={canUseAssistant(
        actor,
        assistantMode(process.env.ADMIN_ASSISTANT),
      )}
    >
      <AdminCategoriesProvider categories={categories}>
        {children}
      </AdminCategoriesProvider>
    </AdminShell>
  );
}
