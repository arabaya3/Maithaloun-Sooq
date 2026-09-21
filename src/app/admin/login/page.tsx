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
    <main className="admin-login-page">
      <section>
        <h1>دخول إدارة سوق ميثلون</h1>
        <p>هذه الصفحة مخصصة للمالك فقط. لا يوجد تسجيل عام.</p>
        <LoginForm nextPath={nextPath} />
      </section>
    </main>
  );
}
