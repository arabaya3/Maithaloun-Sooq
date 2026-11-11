import type { Metadata } from "next";
import { connection } from "next/server";
import { redirect } from "next/navigation";

import {
  getAdminSession,
  getLoginRedirectTarget,
} from "@/features/admin/auth/admin-session";
import { LoginForm } from "@/features/admin/ui/login-form";

export const metadata: Metadata = {
  title: "دخول الإدارة",
  robots: { index: false, follow: false, nocache: true, noarchive: true },
};

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  await connection();
  const session = await getAdminSession();
  const nextPath = getLoginRedirectTarget((await searchParams).next ?? null);
  if (session) redirect(nextPath);

  return (
    <main className="admin-login-page admin-direction-one">
      <section>
        <p className="admin-login-brand">MAYTHA MARKET</p>
        <h1>أهلاً بعودتك</h1>
        <p>سجّل الدخول لإدارة متجرك.</p>
        <LoginForm nextPath={nextPath} />
      </section>
    </main>
  );
}
