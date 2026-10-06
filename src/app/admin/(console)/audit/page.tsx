import type { Metadata } from "next";
import Link from "next/link";
import { ScrollText } from "lucide-react";
import { redirect } from "next/navigation";
import { connection } from "next/server";

import { auditLogService } from "@/features/admin/application/admin-services";
import { requireAdminSession } from "@/features/admin/auth/admin-session";
import { auditEntityLabels } from "@/features/admin/domain/audit-labels";
import { AuditTimeline } from "@/features/admin/ui/audit-timeline";
import { FilterSheet } from "@/features/admin/ui/filter-sheet";
import { EmptyState, PageHeader } from "@/features/admin/ui/kit";

export const metadata: Metadata = { title: "سجل التدقيق" };

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ actor?: string; entity?: string; before?: string }>;
}) {
  await connection();
  const actor = await requireAdminSession();
  if (actor.role !== "owner") redirect("/admin");
  const params = await searchParams;
  const [page, filters] = await Promise.all([
    auditLogService.list(actor, {
      actorId: params.actor,
      entityType: params.entity,
      before: params.before,
    }),
    auditLogService.filters(actor),
  ]);
  const actorId = filters.actors.some((item) => item.id === params.actor)
    ? params.actor
    : "";
  const entity = filters.entityTypes.includes(params.entity ?? "")
    ? params.entity
    : "";
  const keep = new URLSearchParams({
    ...(actorId ? { actor: actorId } : {}),
    ...(entity ? { entity } : {}),
  });

  return (
    <main className="admin-page admin-page--narrow">
      <PageHeader
        title="سجل التدقيق"
        lede="كل تغيير في المتجر: من نفّذه، ومتى، وما الذي تغيّر. لا يُعدَّل ولا يُحذف."
        back={{ href: "/admin/settings", label: "إعدادات المتجر" }}
      />
      <form className="admin-stock-toolbar" action="/admin/audit">
        <FilterSheet
          title="تصفية السجل"
          activeCount={[actorId, entity].filter(Boolean).length}
        >
          <label className="admin-toolbar-field" htmlFor="audit-actor">
            <span>الحساب</span>
            <select id="audit-actor" name="actor" defaultValue={actorId}>
              <option value="">كل الحسابات</option>
              {filters.actors.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <label className="admin-toolbar-field" htmlFor="audit-entity">
            <span>النوع</span>
            <select id="audit-entity" name="entity" defaultValue={entity}>
              <option value="">كل الأنواع</option>
              {filters.entityTypes.map((type) => (
                <option key={type} value={type}>
                  {auditEntityLabels[type] ?? type}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="admin-btn admin-btn-secondary">
            تطبيق التصفية
          </button>
        </FilterSheet>
        {actorId || entity ? (
          <Link
            href="/admin/audit"
            className="admin-btn admin-btn-ghost"
            prefetch={false}
          >
            مسح التصفية
          </Link>
        ) : null}
      </form>
      {page.entries.length ? (
        <section className="admin-panel" aria-label="أحداث السجل">
          <AuditTimeline entries={page.entries} />
          {page.nextCursor ? (
            <Link
              className="admin-btn admin-btn-secondary admin-btn-block"
              href={`/admin/audit?${new URLSearchParams({ ...Object.fromEntries(keep), before: page.nextCursor })}`}
              prefetch={false}
            >
              أحداث أقدم
            </Link>
          ) : null}
        </section>
      ) : (
        <EmptyState Icon={ScrollText} title="لا توجد أحداث مطابقة">
          <p className="admin-muted">
            {params.before ? "وصلتِ إلى أول السجل." : "جرّبي تصفية أخرى."}
          </p>
        </EmptyState>
      )}
    </main>
  );
}
