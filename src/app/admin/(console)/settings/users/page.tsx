import type { Metadata } from "next";
import { CheckCircle2, CircleSlash, Crown, UserRound } from "lucide-react";
import { redirect } from "next/navigation";
import { connection } from "next/server";

import { adminStaffService } from "@/features/admin/application/admin-services";
import {
  readAdminSessionToken,
  requireAdminSession,
} from "@/features/admin/auth/admin-session";
import { formatAdminDateTime } from "@/features/admin/ui/format-admin-datetime";
import { PageHeader, StatusPill } from "@/features/admin/ui/kit";
import { OperatorAccountForm } from "@/features/admin/ui/operator-account-form";
import {
  OperatorActiveToggle,
  RevokeSessionButton,
} from "@/features/admin/ui/staff-controls";

export const metadata: Metadata = { title: "المستخدمون والجلسات" };

const savedMessages: Record<string, string> = {
  revoked: "تم إنهاء جلسة الجهاز.",
  disabled: "تم إيقاف الحساب وإنهاء كل جلساته.",
  enabled: "تم تفعيل الحساب. تدخل الموظفة بكلمة مرورها.",
};

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string }>;
}) {
  await connection();
  const actor = await requireAdminSession();
  if (actor.role !== "owner") redirect("/admin");
  const { saved } = await searchParams;
  const message =
    saved && Object.hasOwn(savedMessages, saved) ? savedMessages[saved] : null;
  const staff = await adminStaffService.list(
    actor,
    await readAdminSessionToken(),
  );

  return (
    <main className="admin-page admin-page--narrow">
      <PageHeader
        title="المستخدمون والجلسات"
        lede="من يدخل لوحة الإدارة ومن أي أجهزة. أنهي جلسة جهاز ضائع، أو أوقفي حساباً كاملاً."
        back={{ href: "/admin/settings", label: "إعدادات المتجر" }}
      />
      {message ? (
        <p className="admin-media-message" data-tone="ok" role="status">
          {message}
        </p>
      ) : null}
      <ul className="admin-supplier-list" aria-label="الحسابات">
        {staff.map((member) => (
          <li
            key={member.id}
            className="admin-panel admin-staff-card"
            aria-label={`حساب ${member.displayName}`}
          >
            <div className="admin-offer-card-head">
              <strong>{member.displayName}</strong>
              <span className="admin-staff-pills">
                <StatusPill
                  tone={member.role === "owner" ? "info" : "neutral"}
                  Icon={member.role === "owner" ? Crown : UserRound}
                >
                  {member.role === "owner" ? "المالك" : "موظفة"}
                </StatusPill>
                <StatusPill
                  tone={member.active ? "ok" : "danger"}
                  Icon={member.active ? CheckCircle2 : CircleSlash}
                >
                  {member.active ? "فعّال" : "موقوف"}
                </StatusPill>
              </span>
            </div>
            <small className="admin-muted">
              <bdi dir="ltr">{member.username}</bdi>
              {member.lastActiveAt
                ? ` · آخر نشاط ${formatAdminDateTime(member.lastActiveAt)}`
                : " · لا جلسات مفتوحة"}
              {member.passwordChangedAt
                ? ` · كلمة المرور منذ ${formatAdminDateTime(member.passwordChangedAt)}`
                : ""}
            </small>
            {member.sessions.length ? (
              <ul
                className="admin-line-list"
                aria-label={`أجهزة ${member.displayName}`}
              >
                {member.sessions.map((session, index) => {
                  const label = `جهاز ${index + 1} لـ ${member.displayName}`;
                  return (
                    <li key={session.id} className="admin-line">
                      <span className="admin-line-main">
                        <strong>
                          {session.current ? "هذا الجهاز" : `جهاز ${index + 1}`}
                        </strong>
                        <small>
                          دخل {formatAdminDateTime(session.createdAt)} · آخر
                          استخدام {formatAdminDateTime(session.lastUsedAt)} ·
                          تنتهي {formatAdminDateTime(session.expiresAt)}
                        </small>
                      </span>
                      <span className="admin-line-side">
                        {session.current ? (
                          <small className="admin-muted">
                            للخروج استخدمي زر الخروج
                          </small>
                        ) : (
                          <RevokeSessionButton
                            sessionId={session.id}
                            label={label}
                          />
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : null}
            {member.role === "operator" ? (
              <OperatorActiveToggle
                userId={member.id}
                active={member.active}
                name={member.displayName}
              />
            ) : null}
          </li>
        ))}
      </ul>

      <section className="admin-panel" aria-labelledby="operator-account-title">
        <h2 id="operator-account-title">حساب موظفة</h2>
        <p className="admin-muted">
          أنشئي حساباً منفصلاً بدل مشاركة كلمة مرور المالك. حفظ كلمة مرور جديدة
          لحساب موجود يُخرجه من كل الأجهزة.
        </p>
        <OperatorAccountForm />
      </section>
    </main>
  );
}
