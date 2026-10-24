/**
 * A post's life: nothing reaches Facebook unless the owner approved it, and a post that reached
 * Facebook is never sent again. «publishing» is a claim held by one worker; a stale claim is not
 * retried blindly but reconciled first, since Facebook may have accepted the request.
 */
export const postStatuses = [
  "draft",
  "approved",
  "publishing",
  "retry_wait",
  "published",
  "failed",
  "rejected",
] as const;
export type PostStatus = (typeof postStatuses)[number];

export const mediaStatuses = ["pending", "ready", "failed"] as const;
export type MediaStatus = (typeof mediaStatuses)[number];

export const postFormats = ["image", "reel"] as const;
export type PostFormat = (typeof postFormats)[number];

export type PostEvent =
  | "approve"
  | "unapprove"
  | "reject"
  | "edit"
  | "claim"
  | "succeed"
  | "fail_retryable"
  | "fail_permanent"
  | "retry_manually"
  | "reopen"
  // Found on the Page after an answer was lost: recorded as published, nothing is sent.
  | "reconcile";

const transitions: Record<
  PostStatus,
  Partial<Record<PostEvent, PostStatus>>
> = {
  draft: { approve: "approved", reject: "rejected", edit: "draft" },
  approved: { unapprove: "draft", claim: "publishing", reject: "rejected" },
  publishing: {
    succeed: "published",
    fail_retryable: "retry_wait",
    fail_permanent: "failed",
    reconcile: "published",
  },
  retry_wait: {
    claim: "publishing",
    unapprove: "draft",
    reject: "rejected",
    reconcile: "published",
  },
  published: {},
  failed: {
    retry_manually: "approved",
    reconcile: "published",
    reopen: "draft",
    reject: "rejected",
  },
  rejected: { reopen: "draft" },
};

export class PostTransitionError extends Error {
  constructor(
    readonly from: PostStatus,
    readonly event: PostEvent,
  ) {
    super("INVALID_POST_TRANSITION");
    this.name = "PostTransitionError";
  }
}

export function nextStatus(from: PostStatus, event: PostEvent): PostStatus {
  const to = transitions[from][event];
  if (!to) throw new PostTransitionError(from, event);
  return to;
}

export function canTransition(from: PostStatus, event: PostEvent): boolean {
  return Boolean(transitions[from][event]);
}

/** A post can be edited only before anyone approved it; approval freezes the exact text and media. */
export function isEditable(status: PostStatus): boolean {
  return status === "draft";
}

export const MAX_PUBLISH_ATTEMPTS = 4;
const BASE_RETRY_MS = 5 * 60_000;
const MAX_RETRY_MS = 6 * 60 * 60_000;

/** Exponential backoff with a ceiling; a rate-limit hint from Meta wins when it is longer. */
export function retryDelayMs(attempt: number, hintMs?: number): number {
  const backoff = Math.min(
    BASE_RETRY_MS * 3 ** Math.max(0, attempt - 1),
    MAX_RETRY_MS,
  );
  return Math.max(backoff, hintMs ?? 0);
}

/** A claim older than this is treated as a crashed worker and must be reconciled with Facebook. */
export const STALE_CLAIM_MS = 15 * 60_000;

export interface ApprovalInput {
  status: PostStatus;
  mediaStatus: MediaStatus;
  captionOk: boolean;
  productsAvailable: boolean;
  scheduledFor: Date | null;
  now: Date;
}

export type ApprovalBlocker =
  | "not_draft"
  | "media_not_ready"
  | "caption_blocked"
  | "product_unavailable"
  | "schedule_in_past";

export function approvalBlockers(input: ApprovalInput): ApprovalBlocker[] {
  const blockers: ApprovalBlocker[] = [];
  if (input.status !== "draft") blockers.push("not_draft");
  if (input.mediaStatus !== "ready") blockers.push("media_not_ready");
  if (!input.captionOk) blockers.push("caption_blocked");
  if (!input.productsAvailable) blockers.push("product_unavailable");
  if (input.scheduledFor && input.scheduledFor < input.now) {
    blockers.push("schedule_in_past");
  }
  return blockers;
}

export const approvalBlockerLabels: Record<ApprovalBlocker, string> = {
  not_draft: "المنشور ليس مسودة.",
  media_not_ready: "الصورة أو الفيديو لم يجهز بعد.",
  caption_blocked: "النص يحتاج تعديلاً قبل الموافقة.",
  product_unavailable: "أحد المنتجات لم يعد متوفراً.",
  schedule_in_past: "موعد النشر مضى. اختاري موعداً جديداً.",
};

export const postStatusLabels: Record<PostStatus, string> = {
  draft: "مسودة",
  approved: "موافق عليه",
  publishing: "جارٍ النشر",
  retry_wait: "بانتظار إعادة المحاولة",
  published: "منشور",
  failed: "فشل النشر",
  rejected: "مرفوض",
};
