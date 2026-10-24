import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CheckCircle2, RotateCcw, Undo2, XCircle } from "lucide-react";

import { requireAdminSession } from "@/features/admin/auth/admin-session";
import { can } from "@/features/admin/domain/permissions";
import { PageHeader } from "@/features/admin/ui/kit";
import {
  approvePostAction,
  editCaptionAction,
  rejectPostAction,
  reopenPostAction,
  reschedulePostAction,
  rerenderPostAction,
  retryPostAction,
  unapprovePostAction,
} from "@/features/social/application/social-actions";
import { socialService } from "@/features/social/application/social-instance";
import { SocialError } from "@/features/social/application/social-service";
import { captionIssueLabels } from "@/features/social/domain/caption-guard";
import {
  approvalBlockerLabels,
  postStatusLabels,
  type PostStatus,
} from "@/features/social/domain/post-lifecycle";
import {
  first,
  PostPreview,
  PostStatusPill,
  postTitle,
  SocialNav,
  SocialNotice,
  StoreTime,
} from "@/features/social/ui/social-ui";
import { STORE_TIME_ZONE } from "@/shared/lib/store-time";

export const metadata: Metadata = { title: "فيسبوك — منشور" };

const localParts = new Intl.DateTimeFormat("en-CA", {
  timeZone: STORE_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function scheduleDefaults(value: Date | null): { date: string; time: string } {
  if (!value) return { date: "", time: "19:30" };
  const parts = Object.fromEntries(
    localParts.formatToParts(value).map((part) => [part.type, part.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
  };
}

const eventLabels: Record<string, string> = {
  created: "أُنشئت المسودة",
  media_ready: "جُهّزت الوسائط",
  media_failed: "تعذّر تجهيز الوسائط",
  approve: "موافقة",
  unapprove: "إلغاء الموافقة",
  reject: "رفض",
  edit: "تعديل",
  claim: "بدء النشر",
  succeed: "نُشر على فيسبوك",
  fail_retryable: "فشل مؤقت، ستُعاد المحاولة",
  fail_permanent: "فشل النشر",
  retry_manually: "إعادة محاولة يدوية",
  reopen: "إعادة فتح",
  reconcile: "وُجد على صفحة فيسبوك فسُجّل منشوراً",
  uncertain: "لم يصل رد فيسبوك؛ سنتحقق من الصفحة قبل أي إعادة",
};

function Hidden({ id, version }: { id: string; version: number }) {
  return (
    <>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="version" value={version} />
    </>
  );
}

export default async function SocialPostPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireAdminSession();
  const { id } = await params;
  const query = await searchParams;
  let post;
  try {
    post = await socialService.view(actor, id);
  } catch (error) {
    if (error instanceof SocialError && error.code === "not_found") notFound();
    throw error;
  }
  const events = await socialService.events(actor, post.id);
  const status = post.status as PostStatus;
  const canPrepare = can(actor, "social.prepare");
  const canApprove = can(actor, "social.approve");
  const schedule = scheduleDefaults(post.scheduledFor);

  return (
    <main className="admin-page">
      <PageHeader
        title={postTitle(post)}
        back={{ href: "/admin/social", label: "التقويم" }}
        actions={<PostStatusPill status={post.status} />}
      />
      <SocialNav current="" />
      <SocialNotice done={first(query.done)} error={first(query.error)} />

      <div className="social-detail">
        <section aria-label="المعاينة" className="admin-stack">
          <PostPreview post={post} large />
          {post.mediaSeconds ? (
            <p className="admin-muted">
              المدة: <bdi dir="ltr">{post.mediaSeconds}s</bdi> · 1080×1920
            </p>
          ) : null}
          {canPrepare && status === "draft" ? (
            <form action={rerenderPostAction}>
              <Hidden id={post.id} version={post.version} />
              <button
                type="submit"
                className="admin-btn admin-btn-ghost admin-btn-sm"
              >
                <RotateCcw size={14} aria-hidden="true" /> إعادة تجهيز الوسائط
              </button>
            </form>
          ) : null}
        </section>

        <section className="admin-stack" aria-label="التفاصيل">
          <dl className="admin-definition-list">
            <div>
              <dt>موعد النشر</dt>
              <dd>
                <StoreTime value={post.scheduledFor} />
              </dd>
            </div>
            {post.publishedAt ? (
              <div>
                <dt>نُشر</dt>
                <dd>
                  <StoreTime value={post.publishedAt} />{" "}
                  {post.metaPostId ? (
                    <bdi dir="ltr" className="admin-muted">
                      {post.metaPostId}
                    </bdi>
                  ) : null}
                </dd>
              </div>
            ) : null}
            <div>
              <dt>المنتجات</dt>
              <dd>
                {post.products.length
                  ? post.products.map((product) => (
                      <span
                        key={product.id}
                        className={
                          product.available ? undefined : "admin-form-error"
                        }
                      >
                        {product.name}
                        {product.available ? "" : " (غير متوفر الآن)"}
                        <br />
                      </span>
                    ))
                  : "بلا منتجات (معلومات المتجر)"}
              </dd>
            </div>
            <div>
              <dt>مصدر النص</dt>
              <dd>
                {post.captionSource === "ai"
                  ? "صياغة بالذكاء الاصطناعي (فُحصت)"
                  : post.captionSource === "owner"
                    ? "عدّلتِه أنتِ"
                    : "قالب ثابت"}
              </dd>
            </div>
            {post.attempts ? (
              <div>
                <dt>محاولات النشر</dt>
                <dd>
                  <bdi dir="ltr">{post.attempts}</bdi>
                  {post.lastErrorCode ? ` · ${post.lastErrorCode}` : ""}
                </dd>
              </div>
            ) : null}
          </dl>

          {!post.captionCheck.ok ? (
            <div className="admin-alert-panel" role="alert">
              <strong>النص يحتاج تعديلاً:</strong>
              <ul className="social-issues">
                {post.captionCheck.issues.map((issue) => (
                  <li key={issue}>{captionIssueLabels[issue]}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {status === "draft" && canPrepare ? (
            <form action={editCaptionAction} className="admin-form">
              <Hidden id={post.id} version={post.version} />
              <label className="admin-field">
                <span>نص المنشور</span>
                <textarea
                  name="caption"
                  className="admin-input social-caption-input"
                  defaultValue={post.caption}
                  maxLength={2000}
                  dir="rtl"
                  required
                />
              </label>
              <button type="submit" className="admin-btn admin-btn-secondary">
                حفظ النص
              </button>
            </form>
          ) : (
            <div className="social-caption-box">{post.caption}</div>
          )}

          {status === "draft" && canPrepare ? (
            <form
              action={reschedulePostAction}
              className="admin-form admin-field-grid"
            >
              <Hidden id={post.id} version={post.version} />
              <label className="admin-field">
                <span>اليوم</span>
                <input
                  type="date"
                  name="date"
                  className="admin-input"
                  defaultValue={schedule.date}
                  required
                />
              </label>
              <label className="admin-field">
                <span>الساعة (بتوقيت فلسطين)</span>
                <input
                  type="time"
                  name="time"
                  className="admin-input"
                  defaultValue={schedule.time}
                  required
                />
              </label>
              <button type="submit" className="admin-btn admin-btn-secondary">
                تغيير الموعد
              </button>
            </form>
          ) : null}

          {status === "draft" && post.blockers.length ? (
            <ul className="social-issues" aria-label="ما يمنع الموافقة">
              {post.blockers.map((blocker) => (
                <li key={blocker}>{approvalBlockerLabels[blocker]}</li>
              ))}
            </ul>
          ) : null}

          <div className="social-actions">
            {status === "draft" && canApprove ? (
              <form action={approvePostAction}>
                <Hidden id={post.id} version={post.version} />
                <button
                  type="submit"
                  className="admin-btn admin-btn-primary"
                  disabled={post.blockers.length > 0}
                >
                  <CheckCircle2 size={16} aria-hidden="true" /> موافقة ونشر في
                  الموعد
                </button>
              </form>
            ) : null}
            {status === "draft" && canPrepare && !canApprove ? (
              <p className="admin-muted">الموافقة على النشر للمالك فقط.</p>
            ) : null}
            {(status === "approved" || status === "retry_wait") &&
            canApprove ? (
              <form action={unapprovePostAction}>
                <Hidden id={post.id} version={post.version} />
                <button type="submit" className="admin-btn admin-btn-secondary">
                  <Undo2 size={16} aria-hidden="true" /> إلغاء الموافقة
                </button>
              </form>
            ) : null}
            {status === "failed" && canApprove && !post.metaObjectId ? (
              <form action={retryPostAction}>
                <Hidden id={post.id} version={post.version} />
                <button type="submit" className="admin-btn admin-btn-primary">
                  <RotateCcw size={16} aria-hidden="true" /> أعيدي المحاولة
                </button>
              </form>
            ) : null}
            {(status === "failed" || status === "rejected") && canPrepare ? (
              <form action={reopenPostAction}>
                <Hidden id={post.id} version={post.version} />
                <button type="submit" className="admin-btn admin-btn-secondary">
                  رجّعيه مسودة
                </button>
              </form>
            ) : null}
            {(status === "draft" ||
              ((status === "approved" ||
                status === "retry_wait" ||
                status === "failed") &&
                canApprove)) &&
            canPrepare ? (
              <form action={rejectPostAction}>
                <Hidden id={post.id} version={post.version} />
                <button type="submit" className="admin-btn admin-btn-danger">
                  <XCircle size={16} aria-hidden="true" /> رفض
                </button>
              </form>
            ) : null}
          </div>

          <section className="admin-panel" aria-labelledby="history-title">
            <h2 id="history-title">السجل</h2>
            <ol className="admin-line-list">
              {events.map(({ event, actorName }) => (
                <li key={event.id} className="admin-line">
                  <span className="admin-line-main">
                    <strong>{eventLabels[event.event] ?? event.event}</strong>
                    {event.toStatus
                      ? ` ← ${postStatusLabels[event.toStatus as PostStatus] ?? event.toStatus}`
                      : ""}
                    {event.detail ? (
                      <small className="admin-muted">
                        {" "}
                        · <bdi dir="ltr">{event.detail}</bdi>
                      </small>
                    ) : null}
                  </span>
                  <span className="admin-line-side">
                    {actorName ?? "النظام"} ·{" "}
                    <StoreTime value={event.createdAt} />
                  </span>
                </li>
              ))}
            </ol>
          </section>
        </section>
      </div>
    </main>
  );
}
