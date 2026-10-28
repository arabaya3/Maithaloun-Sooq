import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CheckCircle2, RotateCcw, Undo2, XCircle } from "lucide-react";

import { requireAdminSession } from "@/features/admin/auth/admin-session";
import { can } from "@/features/admin/domain/permissions";
import { PageHeader } from "@/features/admin/ui/kit";
import {
  approvePostAction,
  editCaptionAction,
  publishNowAction,
  rejectPostAction,
  reopenPostAction,
  reschedulePostAction,
  regenerateCampaignAction,
  rerenderPostAction,
  resolveUncertainAction,
  retryPostAction,
  unapprovePostAction,
} from "@/features/social/application/social-actions";
import { socialService } from "@/features/social/application/social-instance";
import {
  campaignOf,
  SocialError,
} from "@/features/social/application/social-service";
import { campaignTypeLabels } from "@/features/social/domain/campaigns";
import { formatIls } from "@/shared/lib/format-currency";
import { captionIssueLabels } from "@/features/social/domain/caption-guard";
import {
  approvalBlockerLabels,
  postStatusLabels,
  type PostStatus,
} from "@/features/social/domain/post-lifecycle";
import { PublishNowForm } from "@/features/social/ui/publish-now";
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

// «انشر الآن» waits for Make (20 s at most) inside this request. If the function is still stopped,
// the claim stays and the post becomes settleable by the owner; it is never sent again by itself.
export const maxDuration = 60;

/** A Facebook post id as Make or the Graph API returns it: digits, or page_post digits. */
function facebookPostUrl(id: string | null): string | null {
  return id && /^[0-9]{5,30}(_[0-9]{5,30})?$/.test(id)
    ? `https://www.facebook.com/${id}`
    : null;
}

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
  handed_off: "سُلّم إلى Make بانتظار تأكيد فيسبوك",
  owner_resolved: "حسمتِ النتيجة بعد مراجعة الصفحة",
  provider_confirmed: "أكّد Make نتيجة فيسبوك",
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
  const canPublish = can(actor, "social.publish");
  const postUrl = facebookPostUrl(post.metaPostId);
  // A claim with no answer recorded: still sending, or cut off (a timeout) and settleable now.
  const unsettled = socialService.isSettleable(post);
  const publisherName = socialService.publisherName();
  const schedule = scheduleDefaults(post.scheduledFor);
  const campaign = campaignOf(post);

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
                  {postUrl ? (
                    <a href={postUrl} target="_blank" rel="noreferrer">
                      <bdi dir="ltr">{post.metaPostId}</bdi>
                    </a>
                  ) : post.metaPostId ? (
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

          {campaign ? (
            <section className="admin-panel" aria-labelledby="campaign-title">
              <h2 id="campaign-title">
                الحملة: {campaignTypeLabels[campaign.type]}
              </h2>
              <dl className="admin-definition-list">
                <div>
                  <dt>الهدف</dt>
                  <dd>{campaign.objective}</dd>
                </div>
                <div>
                  <dt>لمين</dt>
                  <dd>{campaign.audience}</dd>
                </div>
                <div>
                  <dt>الفكرة</dt>
                  <dd>{campaign.concept}</dd>
                </div>
                {campaign.bundle ? (
                  <div>
                    <dt>{campaign.bundle.nameAr}</dt>
                    <dd>
                      <ul className="social-issues">
                        {campaign.bundle.items.map((item) => (
                          <li key={item.variantId}>
                            {item.name}
                            {item.variantLabel ? ` (${item.variantLabel})` : ""}
                            : <bdi>{formatIls(item.priceAgorot)}</bdi>
                          </li>
                        ))}
                      </ul>
                      <strong>
                        المجموع{" "}
                        <bdi>{formatIls(campaign.bundle.totalAgorot)}</bdi>
                      </strong>
                      {campaign.bundle.freeDelivery
                        ? " · التوصيل مجاني"
                        : ` · ناقصها ${formatIls(campaign.bundle.missingAgorot)} للتوصيل المجاني`}
                    </dd>
                  </div>
                ) : null}
              </dl>
              {!post.campaignCurrent ? (
                <p className="admin-form-error" role="alert">
                  تغيّرت الأسعار أو قاعدة التوصيل منذ تجهيز هذه الحملة، فلا يمكن
                  الموافقة عليها. اقترحي حملة أخرى.
                </p>
              ) : null}
              {status === "draft" && canPrepare ? (
                <form action={regenerateCampaignAction}>
                  <Hidden id={post.id} version={post.version} />
                  <button
                    type="submit"
                    className="admin-btn admin-btn-secondary"
                  >
                    <RotateCcw size={16} aria-hidden="true" /> اقتراح حملة أخرى
                  </button>
                </form>
              ) : null}
            </section>
          ) : null}

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

          {status === "publishing" && !unsettled ? (
            <p className="admin-note" role="status">
              جارٍ إرسال المنشور. حدّثي الصفحة بعد قليل. إذا لم تصل نتيجة خلال
              ربع ساعة، ستظهر هنا خيارات التأكد من صفحة فيسبوك.
            </p>
          ) : null}

          {unsettled && canApprove ? (
            <section
              className="admin-alert-panel social-settle"
              aria-labelledby="settle-title"
            >
              <h2 id="settle-title">نتيجة النشر غير مؤكدة</h2>
              <p>
                {post.lastErrorCode === "AWAITING_CONFIRMATION"
                  ? "سُلّم المنشور إلى Make ولم يصل تأكيد فيسبوك بعد."
                  : post.lastErrorCode === "MAKE_PAGE_MISMATCH"
                    ? "أرسل Make رقم منشور على صفحة غير صفحة MAYTHA MARKET. افحصي صفحتنا والصفحة الأخرى، واحذفي المنشور من الصفحة الخطأ إن وُجد."
                    : post.lastErrorCode === "MAKE_PARTIAL"
                      ? "أبلغ Make أن جزءاً فقط نُشر."
                      : post.lastErrorCode
                        ? "لم يصل رد بعد إرسال المنشور."
                        : "انقطع الإرسال قبل أن يصل رد."}{" "}
                لن يُعاد إرساله تلقائياً. افتحي صفحة فيسبوك وتأكدي، ثم اختاري:
              </p>
              <div className="social-actions">
                <form action={resolveUncertainAction} className="admin-form">
                  <Hidden id={post.id} version={post.version} />
                  <input type="hidden" name="outcome" value="published" />
                  <label className="admin-field">
                    <span>رقم المنشور على فيسبوك (اختياري)</span>
                    <input
                      name="facebookPostId"
                      className="admin-input"
                      dir="ltr"
                      inputMode="numeric"
                      pattern="[0-9_]{5,60}"
                    />
                  </label>
                  <button type="submit" className="admin-btn admin-btn-primary">
                    <CheckCircle2 size={16} aria-hidden="true" /> نعم، المنشور
                    موجود على الصفحة
                  </button>
                </form>
                <form action={resolveUncertainAction}>
                  <Hidden id={post.id} version={post.version} />
                  <input type="hidden" name="outcome" value="not_published" />
                  <button
                    type="submit"
                    className="admin-btn admin-btn-secondary"
                  >
                    <XCircle size={16} aria-hidden="true" /> لا، غير موجود
                  </button>
                </form>
              </div>
            </section>
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
            {status === "approved" &&
            canPublish &&
            post.mediaStatus === "ready" &&
            post.mediaUrl ? (
              <PublishNowForm
                action={publishNowAction}
                id={post.id}
                version={post.version}
                title={postTitle(post)}
                scheduled={new Intl.DateTimeFormat("ar", {
                  timeZone: STORE_TIME_ZONE,
                  dateStyle: "medium",
                  timeStyle: "short",
                }).format(post.scheduledFor ?? undefined)}
              />
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
              <form action={retryPostAction} className="admin-form">
                <Hidden id={post.id} version={post.version} />
                {publisherName === "make" &&
                post.attempts > 0 &&
                post.lastErrorCode !== "OWNER_CONFIRMED_NOT_PUBLISHED" ? (
                  <label className="social-toggle">
                    <input type="checkbox" name="confirmedAbsent" required />
                    <span>
                      تأكدتُ من صفحة فيسبوك أن هذا المنشور غير موجود عليها.
                    </span>
                  </label>
                ) : null}
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
