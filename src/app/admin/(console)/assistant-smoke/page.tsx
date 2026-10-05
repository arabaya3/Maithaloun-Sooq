import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";

import { requireAdminSession } from "@/features/admin/auth/admin-session";
import { AssistantSmokeTest } from "@/features/assistant/ui/assistant-smoke-test";
import {
  SMOKE_QUESTIONS,
  smokeTestEnabled,
} from "@/features/assistant/domain/smoke-test";

export const metadata: Metadata = { title: "فحص المساعد" };

export default async function AssistantSmokePage() {
  await connection();
  const actor = await requireAdminSession();
  if (actor.role !== "owner") redirect("/admin");
  if (!smokeTestEnabled(process.env)) notFound();
  return (
    <main className="admin-page">
      <header className="admin-page-header">
        <div>
          <h1>فحص المساعد</h1>
          <p className="admin-lede">
            أسئلة قراءة ثابتة فقط. لا يجهّز بطاقات ولا يغيّر أي بيانات، وتظهر
            أسماء الزبائن مختصرة.
          </p>
        </div>
      </header>
      <AssistantSmokeTest questions={SMOKE_QUESTIONS.map((row) => row.text)} />
    </main>
  );
}
