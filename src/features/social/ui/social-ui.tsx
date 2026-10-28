import Link from "next/link";
import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  Clapperboard,
  Clock,
  Image as ImageIcon,
  Loader2,
  RotateCcw,
  Send,
  XCircle,
  type LucideIcon,
} from "lucide-react";

import { StatusPill, type PillTone } from "@/features/admin/ui/kit";
import {
  approvalBlockerLabels,
  postStatusLabels,
  type ApprovalBlocker,
  type PostStatus,
} from "@/features/social/domain/post-lifecycle";
import {
  postKindLabels,
  reelTemplateLabels,
  type PostKind,
  type ReelTemplate,
} from "@/features/social/domain/captions";
import {
  metaFailureLabels,
  type MetaFailureKind,
} from "@/features/social/domain/meta-errors";
import { STORE_TIME_ZONE } from "@/shared/lib/store-time";

import type { SocialPostRow } from "../application/social-service";

const tabs = [
  { href: "/admin/social", label: "التقويم" },
  { href: "/admin/social/queue?status=draft", label: "المسودات" },
  { href: "/admin/social/queue?status=approved", label: "قائمة النشر" },
  { href: "/admin/social/queue?status=published", label: "المنشور" },
  { href: "/admin/social/queue?status=failed", label: "الفاشل" },
  { href: "/admin/social/inbox", label: "التعليقات" },
  { href: "/admin/social/analytics", label: "التحليلات" },
  { href: "/admin/social/settings", label: "الإعدادات" },
];

export function SocialNav({ current }: { current: string }) {
  return (
    <nav className="admin-tabs social-tabs" aria-label="أقسام فيسبوك">
      {tabs.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          prefetch={false}
          className="admin-tab"
          aria-current={tab.href === current ? "page" : undefined}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}

const statusPills: Record<PostStatus, { tone: PillTone; Icon: LucideIcon }> = {
  draft: { tone: "neutral", Icon: CircleDashed },
  approved: { tone: "info", Icon: Clock },
  publishing: { tone: "info", Icon: Loader2 },
  retry_wait: { tone: "warn", Icon: RotateCcw },
  published: { tone: "ok", Icon: CheckCircle2 },
  failed: { tone: "danger", Icon: XCircle },
  rejected: { tone: "neutral", Icon: XCircle },
};

export function PostStatusPill({ status }: { status: string }) {
  const known = (status in statusPills ? status : "draft") as PostStatus;
  const pill = statusPills[known];
  return (
    <StatusPill tone={pill.tone} Icon={pill.Icon}>
      {postStatusLabels[known]}
    </StatusPill>
  );
}

const dateTime = new Intl.DateTimeFormat("ar-PS-u-nu-latn", {
  timeZone: STORE_TIME_ZONE,
  weekday: "long",
  day: "numeric",
  month: "long",
  hour: "2-digit",
  minute: "2-digit",
});

export function StoreTime({ value }: { value: Date | null }) {
  if (!value) return <span className="admin-muted">بلا موعد</span>;
  return <time dateTime={value.toISOString()}>{dateTime.format(value)}</time>;
}

export function postTitle(
  post: Pick<SocialPostRow, "format" | "kind" | "reelTemplate">,
): string {
  if (post.format === "reel" && post.reelTemplate) {
    return reelTemplateLabels[post.reelTemplate as ReelTemplate] ?? "ريل";
  }
  return postKindLabels[post.kind as PostKind] ?? post.kind;
}

export function PostPreview({
  post,
  large = false,
}: {
  post: Pick<
    SocialPostRow,
    "format" | "mediaStatus" | "mediaUrl" | "posterUrl" | "mediaError"
  >;
  large?: boolean;
}) {
  if (post.mediaStatus !== "ready" || !post.mediaUrl) {
    return (
      <div
        className={`social-preview social-preview--empty${large ? "social-preview--large" : ""}`}
      >
        {post.mediaStatus === "failed" ? (
          <AlertTriangle aria-hidden="true" />
        ) : (
          <Loader2 aria-hidden="true" />
        )}
        <span>
          {post.mediaStatus === "failed"
            ? `تعذّر التجهيز (${post.mediaError ?? "?"})`
            : post.format === "reel"
              ? "بانتظار عامل الفيديو"
              : "بانتظار التجهيز"}
        </span>
      </div>
    );
  }
  if (post.format === "reel") {
    return large ? (
      <video
        className="social-preview social-preview--reel social-preview--large"
        src={post.mediaUrl}
        poster={post.posterUrl ?? undefined}
        controls
        playsInline
        preload="metadata"
      />
    ) : (
      <div className="social-preview social-preview--reel">
        {/* eslint-disable-next-line @next/next/no-img-element -- previews come from storage or the admin media route */}
        <img src={post.posterUrl ?? ""} alt="" loading="lazy" />
        <Clapperboard className="social-preview-badge" aria-label="ريل" />
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- previews come from storage or the admin media route
    <img
      className={`social-preview${large ? "social-preview--large" : ""}`}
      src={post.mediaUrl}
      alt="معاينة المنشور"
      loading="lazy"
    />
  );
}

export function FormatIcon({ format }: { format: string }) {
  return format === "reel" ? (
    <Clapperboard size={16} aria-label="ريل" />
  ) : (
    <ImageIcon size={16} aria-label="صورة" />
  );
}

const doneMessages: Record<string, string> = {
  approved: "تمت الموافقة. سيُنشر في موعده.",
  unapproved: "أُلغيت الموافقة وعاد المنشور مسودة.",
  rejected: "رُفض المنشور.",
  reopened: "عاد المنشور مسودة.",
  retrying: "ستُعاد محاولة النشر.",
  rerender: "سيُعاد تجهيز الصورة أو الفيديو.",
  caption: "حُفظ النص.",
  scheduled: "تغيّر الموعد.",
  drafted: "جُهّزت المسودات للأسبوعين القادمين.",
  rendered: "جُهّزت الصور المعلّقة.",
  resolved: "أُغلق التعليق.",
  replied: "أُرسل الرد.",
  settings: "حُفظت الإعدادات.",
  connected: "رُبطت صفحة فيسبوك.",
  disconnected: "فُصلت صفحة فيسبوك.",
  resolved_published: "سُجّل المنشور منشوراً على فيسبوك.",
  resolved_not_published:
    "سُجّل أنه لم يُنشر. يمكنك إعادة المحاولة عندما تريدين.",
};

const errorMessages: Record<string, string> = {
  not_found: "المنشور غير موجود.",
  stale: "تغيّر المنشور منذ فتحتِ الصفحة. حدّثيها وأعيدي المحاولة.",
  invalid: "لا يمكن تنفيذ هذا الآن.",
  forbidden: "هذه الخطوة للمالك فقط.",
  not_connected: "صفحة فيسبوك غير مربوطة.",
  token_invalid: "رمز فيسبوك غير صالح.",
  vault_missing: "مفتاح التشفير SOCIAL_TOKEN_KEY غير مضبوط على الخادم.",
  meta_app_missing:
    "لا يُحفظ رمز فيسبوك قبل فحصه. اضبطي META_APP_ID وMETA_APP_SECRET على الخادم.",
  token_wrong_app: "هذا الرمز صادر لتطبيق فيسبوك آخر، لا لتطبيق المتجر.",
  token_wrong_page: "هذا الرمز لصفحة أخرى، لا لصفحة MAYTHA MARKET.",
  token_missing_scopes:
    "الرمز ينقصه بعض الصلاحيات المطلوبة. أعيدي الربط ووافقي على كل الصلاحيات.",
  already_published:
    "وجدنا هذا المنشور على صفحة فيسبوك فعلاً، فسُجّل منشوراً ولم يُرسل مرة ثانية.",
  confirm_absent_required:
    "قبل إعادة الإرسال، تأكدي من صفحة فيسبوك أن المنشور غير موجود وأشّري على التأكيد.",
  not_uncertain: "هذا المنشور ليس بانتظار تأكيد.",
  still_processing:
    "فيسبوك ما زال يعالج المحاولة السابقة. انتظري قليلاً ثم حدّثي الصفحة.",
  state: "انتهت محاولة الربط. ابدئي من جديد.",
  cancelled: "أُلغي الربط من فيسبوك.",
  no_page: "لم نجد صفحة MAYTHA MARKET بين الصفحات التي تديرينها.",
  failed: "تعذّر الربط مع فيسبوك.",
};

export function SocialNotice({
  done,
  error,
}: {
  done?: string;
  error?: string;
}) {
  if (done && doneMessages[done]) {
    return (
      <p className="admin-note social-notice social-notice--ok" role="status">
        <Send size={16} aria-hidden="true" /> {doneMessages[done]}
      </p>
    );
  }
  if (!error) return null;
  let message = errorMessages[error];
  if (error.startsWith("blocked:")) {
    message = error
      .slice(8)
      .split(",")
      .map((code) => approvalBlockerLabels[code as ApprovalBlocker] ?? code)
      .join(" ");
  } else if (error.startsWith("meta_")) {
    message =
      metaFailureLabels[error.slice(5) as MetaFailureKind] ?? "خطأ من فيسبوك.";
  }
  return (
    <p className="admin-form-error social-notice" role="alert">
      {message ?? "حدث خطأ."}
    </p>
  );
}

export function first(
  value: string | string[] | undefined,
): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
