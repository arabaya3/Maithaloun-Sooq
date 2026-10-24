import type { Metadata } from "next";
import Link from "next/link";
import { Inbox } from "lucide-react";

import { requireAdminSession } from "@/features/admin/auth/admin-session";
import { EmptyState, PageHeader } from "@/features/admin/ui/kit";
import { socialService } from "@/features/social/application/social-instance";
import { metaFailureLabels } from "@/features/social/domain/meta-errors";
import type { PostStatus } from "@/features/social/domain/post-lifecycle";
import {
  FormatIcon,
  first,
  PostPreview,
  PostStatusPill,
  postTitle,
  SocialNav,
  SocialNotice,
  StoreTime,
} from "@/features/social/ui/social-ui";

export const metadata: Metadata = { title: "فيسبوك — المنشورات" };

const views: Record<
  string,
  { title: string; statuses: PostStatus[]; tab: string; empty: string }
> = {
  draft: {
    title: "مسودات للمراجعة",
    statuses: ["draft"],
    tab: "/admin/social/queue?status=draft",
    empty: "لا مسودات الآن.",
  },
  approved: {
    title: "قائمة النشر",
    statuses: ["approved", "publishing", "retry_wait"],
    tab: "/admin/social/queue?status=approved",
    empty: "لا شيء بانتظار النشر.",
  },
  published: {
    title: "المنشور",
    statuses: ["published"],
    tab: "/admin/social/queue?status=published",
    empty: "لم يُنشر شيء بعد.",
  },
  failed: {
    title: "فشل النشر",
    statuses: ["failed", "rejected"],
    tab: "/admin/social/queue?status=failed",
    empty: "لا منشورات فاشلة.",
  },
};

function failureText(code: string | null): string | null {
  if (!code) return null;
  if (code === "PRODUCT_UNAVAILABLE") return "منتج لم يعد متوفراً، فلم يُنشر.";
  if (code === "MEDIA_NOT_PUBLIC")
    return "الوسائط ليست على رابط عام (التخزين غير مضبوط).";
  if (code === "CONTENT_CHANGED") return "تغيّر المحتوى بعد الموافقة.";
  if (code === "IMAGE_TOO_LARGE") return "الصورة أكبر من حد فيسبوك.";
  if (code === "REEL_PROCESSING_FAILED")
    return "فيسبوك لم يستطع معالجة الفيديو.";
  if (code === "META_UNKNOWN_OUTCOME")
    return "لم يصل رد فيسبوك؛ نتحقق من الصفحة قبل أي إعادة.";
  const kind = /^META_([A-Z_]+?)(?:_\d+)?$/.exec(code)?.[1]?.toLowerCase();
  return (
    (kind && metaFailureLabels[kind as keyof typeof metaFailureLabels]) || code
  );
}

export default async function SocialQueuePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireAdminSession();
  const params = await searchParams;
  const view = views[first(params.status) ?? "draft"] ?? views.draft!;
  const rows = await socialService.listPosts(actor, {
    statuses: view.statuses,
  });
  const ordered =
    view.statuses.includes("published") || view.statuses.includes("failed")
      ? [...rows].reverse()
      : rows;

  return (
    <main className="admin-page">
      <PageHeader title={view.title} />
      <SocialNav current={view.tab} />
      <SocialNotice done={first(params.done)} error={first(params.error)} />
      {ordered.length ? (
        <ul className="social-grid" aria-label={view.title}>
          {ordered.map(({ post, engagement }) => (
            <li key={post.id}>
              <Link
                href={`/admin/social/posts/${post.id}`}
                prefetch={false}
                className="social-card"
              >
                <PostPreview post={post} />
                <span className="social-card-meta">
                  <FormatIcon format={post.format} />
                  <strong>{postTitle(post)}</strong>
                  <PostStatusPill status={post.status} />
                </span>
                <span className="social-card-meta">
                  <StoreTime value={post.publishedAt ?? post.scheduledFor} />
                </span>
                <span className="social-card-caption">{post.caption}</span>
                {engagement ? (
                  <span className="social-card-meta">
                    👍 {engagement.reactions} · 💬 {engagement.comments} · ↗{" "}
                    {engagement.shares}
                    {engagement.reach !== null
                      ? ` · وصول ${engagement.reach}`
                      : ""}
                  </span>
                ) : null}
                {post.lastErrorCode ? (
                  <span className="admin-form-error">
                    {failureText(post.lastErrorCode)}
                  </span>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState Icon={Inbox} title={view.empty} />
      )}
    </main>
  );
}
