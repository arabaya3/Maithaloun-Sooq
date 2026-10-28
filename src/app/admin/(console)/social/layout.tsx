import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";

import { requireAdminSession } from "@/features/admin/auth/admin-session";
import { can } from "@/features/admin/domain/permissions";
import { socialEnabled } from "@/features/social/application/social-instance";

import "@/features/social/ui/social.css";

/** The Facebook manager exists only when SOCIAL_MANAGER=on; otherwise the store is untouched. */
export default async function SocialLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await connection();
  if (!socialEnabled()) notFound();
  const actor = await requireAdminSession();
  if (!can(actor, "social.view")) redirect("/admin");
  return children;
}
