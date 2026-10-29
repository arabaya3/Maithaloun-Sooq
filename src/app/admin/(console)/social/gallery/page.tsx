import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";

import { requireAdminSession } from "@/features/admin/auth/admin-session";
import { PageHeader } from "@/features/admin/ui/kit";
import { campaignOf } from "@/features/social/application/social-service";
import { socialService } from "@/features/social/application/social-instance";
import { angleCreative } from "@/features/social/domain/campaign-creative";
import {
  PostStatusPill,
  postTitle,
  SocialNav,
  StoreTime,
} from "@/features/social/ui/social-ui";

export const metadata: Metadata = { title: "فيسبوك — معرض التصاميم" };

/** Every campaign as a picture: what is ready, what still needs work and what needs artwork. */
export default async function SocialGalleryPage() {
  const actor = await requireAdminSession();
  const rows = await socialService.listPosts(actor, {
    statuses: ["draft", "approved", "published", "failed"],
    limit: 120,
  });
  const campaigns = rows
    .map((row) => row.post)
    .filter((post) => post.kind === "campaign")
    .reverse();
  return (
    <main className="admin-page">
      <PageHeader
        title="معرض التصاميم"
        lede="كل حملة بصورتها. افتحي أي تصميم لتراجعيه، تختاري الافتتاحية، أو تنزّلي المقاسات الثانية."
      />
      <SocialNav current="/admin/social/gallery" />
      {campaigns.length ? (
        <ul className="social-gallery">
          {campaigns.map((post) => {
            const campaign = campaignOf(post);
            const name =
              (campaign && angleCreative[campaign.angleId]?.nameAr) ||
              postTitle(post);
            return (
              <li key={post.id}>
                <Link
                  href={`/admin/social/posts/${post.id}`}
                  prefetch={false}
                  className="social-gallery-card"
                >
                  {post.mediaStatus === "ready" && post.mediaUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- stored campaign image
                    <img
                      src={post.mediaUrl}
                      alt={name}
                      loading="lazy"
                      width={1080}
                      height={1350}
                    />
                  ) : (
                    <span className="social-gallery-empty">
                      {post.mediaError === "MASCOT_ARTWORK_REQUIRED" ? (
                        <>
                          <AlertTriangle size={18} aria-hidden="true" /> يحتاج
                          رسمة لميثو
                        </>
                      ) : post.mediaStatus === "failed" ? (
                        <>
                          <AlertTriangle size={18} aria-hidden="true" /> تعذّر
                          التجهيز
                        </>
                      ) : (
                        "بانتظار التجهيز"
                      )}
                    </span>
                  )}
                  <span className="social-gallery-meta">
                    <strong>{name}</strong>
                    <PostStatusPill status={post.status} />
                    <small className="admin-muted">
                      <StoreTime value={post.scheduledFor} />
                    </small>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="admin-empty">
          لا حملات بعد. جهّزي حملات أسبوعين من التقويم.
        </p>
      )}
    </main>
  );
}
