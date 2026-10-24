import type { Metadata } from "next";
import Link from "next/link";
import {
  CalendarDays,
  CheckCircle2,
  Clock,
  Link2Off,
  PenLine,
  XCircle,
} from "lucide-react";

import { requireAdminSession } from "@/features/admin/auth/admin-session";
import { can } from "@/features/admin/domain/permissions";
import { MetricCard, PageHeader } from "@/features/admin/ui/kit";
import {
  draftTwoWeeksAction,
  renderPendingAction,
} from "@/features/social/application/social-actions";
import { socialService } from "@/features/social/application/social-instance";
import {
  FormatIcon,
  first,
  PostPreview,
  PostStatusPill,
  postTitle,
  SocialNav,
  SocialNotice,
} from "@/features/social/ui/social-ui";
import {
  addDays,
  startOfStoreDay,
  STORE_TIME_ZONE,
  toStoreDate,
  todayInStoreZone,
} from "@/shared/lib/store-time";

export const metadata: Metadata = { title: "فيسبوك — التقويم" };

const dayLabel = new Intl.DateTimeFormat("ar-PS-u-nu-latn", {
  timeZone: STORE_TIME_ZONE,
  weekday: "long",
});
const dateLabel = new Intl.DateTimeFormat("ar-PS-u-nu-latn", {
  timeZone: STORE_TIME_ZONE,
  day: "numeric",
  month: "long",
});
const timeLabel = new Intl.DateTimeFormat("ar-PS-u-nu-latn", {
  timeZone: STORE_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
});

export default async function SocialCalendarPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireAdminSession();
  const params = await searchParams;
  const today = todayInStoreZone();
  const [counts, rows, connection] = await Promise.all([
    socialService.statusCounts(actor),
    socialService.listPosts(actor, {
      from: startOfStoreDay(today),
      to: startOfStoreDay(addDays(today, 31)),
      statuses: [
        "draft",
        "approved",
        "publishing",
        "retry_wait",
        "published",
        "failed",
      ],
    }),
    socialService.connection(),
  ]);
  const byDay = new Map<string, typeof rows>();
  for (const row of rows) {
    if (!row.post.scheduledFor) continue;
    const day = toStoreDate(row.post.scheduledFor);
    byDay.set(day, [...(byDay.get(day) ?? []), row]);
  }
  const days = Array.from({ length: 30 }, (_, index) => addDays(today, index));

  return (
    <main className="admin-page">
      <PageHeader
        title="فيسبوك"
        lede="منشورات وريلز من منتجات المتجر الحقيقية. لا يُنشر شيء قبل موافقتك."
        actions={
          can(actor, "social.prepare") ? (
            <div className="social-actions">
              <form action={draftTwoWeeksAction}>
                <button type="submit" className="admin-btn admin-btn-primary">
                  <PenLine size={16} aria-hidden="true" /> جهّزي مسودات أسبوعين
                </button>
              </form>
              <form action={renderPendingAction}>
                <button type="submit" className="admin-btn admin-btn-secondary">
                  جهّزي الصور المعلّقة
                </button>
              </form>
            </div>
          ) : null
        }
      />
      <SocialNav current="/admin/social" />
      <SocialNotice done={first(params.done)} error={first(params.error)} />

      {!connection || connection.status !== "connected" ? (
        <p className="admin-note" role="status">
          <Link2Off size={16} aria-hidden="true" /> صفحة فيسبوك غير مربوطة
          {connection ? " (انتهت صلاحية الربط)" : ""}. المنشورات الموافق عليها
          تنتظر حتى{" "}
          <Link href="/admin/social/settings" prefetch={false}>
            تربطي الصفحة
          </Link>
          .
        </p>
      ) : null}

      <section className="admin-metric-grid" aria-label="ملخص">
        <MetricCard
          label="مسودات للمراجعة"
          value={counts.draft ?? 0}
          Icon={PenLine}
          href="/admin/social/queue?status=draft"
        />
        <MetricCard
          label="بانتظار موعد النشر"
          value={(counts.approved ?? 0) + (counts.retry_wait ?? 0)}
          Icon={Clock}
          href="/admin/social/queue?status=approved"
        />
        <MetricCard
          label="منشور"
          value={counts.published ?? 0}
          Icon={CheckCircle2}
          tone="success"
          href="/admin/social/queue?status=published"
        />
        <MetricCard
          label="فشل النشر"
          value={counts.failed ?? 0}
          Icon={XCircle}
          tone={counts.failed ? "danger" : "neutral"}
          href="/admin/social/queue?status=failed"
        />
      </section>

      <section className="admin-panel" aria-labelledby="calendar-title">
        <h2 id="calendar-title">
          <CalendarDays size={18} aria-hidden="true" /> الثلاثون يوماً القادمة
        </h2>
        <p className="admin-muted">
          الخطة: ٤ منشورات وريلزان كل أسبوع، وتقرير أسبوعي كل أحد.
        </p>
        <ol className="social-calendar">
          {days.map((day) => {
            const items = byDay.get(day) ?? [];
            const noon = new Date(`${day}T12:00:00Z`);
            return (
              <li key={day} className="social-day">
                <span className="social-day-label">
                  {dayLabel.format(noon)}
                  <small>{dateLabel.format(noon)}</small>
                </span>
                <span className="social-day-items">
                  {items.length ? (
                    items.map(({ post }) => (
                      <Link
                        key={post.id}
                        href={`/admin/social/posts/${post.id}`}
                        prefetch={false}
                        className="social-chip"
                      >
                        <PostPreview post={post} />
                        <span className="social-card-meta">
                          <FormatIcon format={post.format} />
                          <strong>{postTitle(post)}</strong>
                          <bdi dir="ltr">
                            {timeLabel.format(post.scheduledFor!)}
                          </bdi>
                          <PostStatusPill status={post.status} />
                        </span>
                      </Link>
                    ))
                  ) : (
                    <span className="admin-muted">—</span>
                  )}
                </span>
              </li>
            );
          })}
        </ol>
      </section>
    </main>
  );
}
