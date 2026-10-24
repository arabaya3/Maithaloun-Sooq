import type { Metadata } from "next";
import { MessageSquare } from "lucide-react";

import { requireAdminSession } from "@/features/admin/auth/admin-session";
import { can } from "@/features/admin/domain/permissions";
import { EmptyState, PageHeader, StatusPill } from "@/features/admin/ui/kit";
import {
  resolveCommentAction,
  sendHeldReplyAction,
} from "@/features/social/application/social-actions";
import { socialService } from "@/features/social/application/social-instance";
import {
  escalationLabels,
  type EscalationReason,
} from "@/features/social/domain/comment-policy";
import {
  first,
  SocialNav,
  SocialNotice,
  StoreTime,
} from "@/features/social/ui/social-ui";

export const metadata: Metadata = { title: "فيسبوك — التعليقات" };

export default async function SocialInboxPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireAdminSession();
  const params = await searchParams;
  const [rows, settings] = await Promise.all([
    socialService.openComments(actor),
    socialService.settings(),
  ]);

  return (
    <main className="admin-page">
      <PageHeader
        title="التعليقات"
        lede={
          settings.autoReplyFaq
            ? "الأسئلة الموثّقة (التوصيل والدفع وطريقة الطلب) تُجاب تلقائياً بنص ثابت. كل ما سواها هنا لك."
            : "الردود التلقائية متوقفة؛ الأجوبة الموثّقة تنتظر موافقتك هنا. الشكاوى والاسترجاع وأسئلة التوفر لك دائماً."
        }
      />
      <SocialNav current="/admin/social/inbox" />
      <SocialNotice done={first(params.done)} error={first(params.error)} />
      {rows.length ? (
        <section className="admin-panel">
          {rows.map(({ comment, caption }) => (
            <article key={comment.id} className="social-comment">
              <div className="social-card-meta">
                <strong>{comment.authorName ?? "زائر"}</strong>
                <StoreTime value={comment.commentedAt} />
                {comment.decision === "escalate" ? (
                  <StatusPill tone="warn" Icon={MessageSquare}>
                    {escalationLabels[comment.reason as EscalationReason] ??
                      "يحتاج رداً"}
                  </StatusPill>
                ) : (
                  <StatusPill tone="info" Icon={MessageSquare}>
                    جواب موثّق جاهز
                  </StatusPill>
                )}
              </div>
              <blockquote>{comment.message}</blockquote>
              <p className="admin-muted">على منشور: {caption.split("\n")[0]}</p>
              {comment.replyText ? (
                <p>
                  <strong>الرد المقترح:</strong> {comment.replyText}
                </p>
              ) : (
                <p className="admin-muted">
                  لا رد تلقائي؛ ردّي بنفسك من صفحة فيسبوك.
                </p>
              )}
              <div className="social-actions">
                {comment.decision === "reply" &&
                can(actor, "social.approve") ? (
                  <form action={sendHeldReplyAction}>
                    <input type="hidden" name="id" value={comment.id} />
                    <button
                      type="submit"
                      className="admin-btn admin-btn-primary admin-btn-sm"
                    >
                      أرسلي الرد
                    </button>
                  </form>
                ) : null}
                {can(actor, "social.prepare") ? (
                  <form action={resolveCommentAction}>
                    <input type="hidden" name="id" value={comment.id} />
                    <button
                      type="submit"
                      className="admin-btn admin-btn-secondary admin-btn-sm"
                    >
                      تمّ التعامل معه
                    </button>
                  </form>
                ) : null}
              </div>
            </article>
          ))}
        </section>
      ) : (
        <EmptyState Icon={MessageSquare} title="لا تعليقات تنتظرك." />
      )}
    </main>
  );
}
