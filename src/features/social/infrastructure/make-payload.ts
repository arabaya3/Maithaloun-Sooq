import { z } from "zod";

import type { PublishRequest } from "@/features/social/domain/publisher";

/**
 * The one place that knows the request and reply of the «MAYTHA Social Publish» Make scenario.
 *
 * Scenario data structure (confirmed): required strings postId, idempotencyKey, contentType,
 * caption; optional strings mediaUrl, coverUrl, pageId, callbackUrl, schema; optional number
 * attempt. Optional fields are omitted when absent, never sent as null. contentType is text,
 * image (exactly one image URL) or reel (a public video URL).
 * Replies: 200 with facebookPostId (text, image) or facebookObjectId (reel); 422 unsupported
 * content; 502 publishing module error.
 */
export const MAKE_PAYLOAD_SCHEMA = "maytha.social-post.v1";

export const makeContentTypes = ["text", "image", "reel"] as const;
export type MakeContentType = (typeof makeContentTypes)[number];

const requiredString = z.string().min(1);
const httpsUrl = z
  .string()
  .regex(/^https:\/\/[^\s]+$/)
  .max(2_000);

/** Exactly the scenario's fields: anything else, or a null, is refused before sending. */
export const makeRequestSchema = z
  .object({
    postId: requiredString,
    idempotencyKey: requiredString,
    contentType: z.enum(makeContentTypes),
    caption: requiredString.max(5_000),
    mediaUrl: httpsUrl.optional(),
    coverUrl: httpsUrl.optional(),
    pageId: requiredString.optional(),
    callbackUrl: httpsUrl.optional(),
    schema: requiredString.optional(),
    attempt: z.number().int().positive().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.contentType === "text" && value.mediaUrl) {
      context.addIssue({
        code: "custom",
        path: ["mediaUrl"],
        message: "text has no media",
      });
    }
    if (value.contentType !== "text" && !value.mediaUrl) {
      context.addIssue({
        code: "custom",
        path: ["mediaUrl"],
        message: "media required",
      });
    }
    if (value.contentType !== "reel" && value.coverUrl) {
      context.addIssue({
        code: "custom",
        path: ["coverUrl"],
        message: "cover is for reels",
      });
    }
  });
export type MakePayload = z.infer<typeof makeRequestSchema>;

/** The scenario takes exactly one image or one video; anything else is refused before any call. */
export function contentTypeOf(request: PublishRequest): MakeContentType | null {
  if (request.format === "reel") {
    return request.mediaUrls.length === 1 ? "reel" : null;
  }
  if (request.mediaUrls.length === 0) return "text";
  return request.mediaUrls.length === 1 ? "image" : null;
}

function present<T>(
  key: string,
  value: T | null | undefined,
): Record<string, T> {
  return value === null || value === undefined || value === ""
    ? {}
    : { [key]: value };
}

export function buildMakePayload(
  request: PublishRequest,
  context: { pageId: string | null; callbackUrl: string | null },
): MakePayload {
  const contentType = contentTypeOf(request);
  if (!contentType) throw new Error("MAKE_UNSUPPORTED_CONTENT");
  const parsed = makeRequestSchema.safeParse({
    postId: request.postId,
    idempotencyKey: request.idempotencyKey,
    contentType,
    caption: request.caption,
    ...present("mediaUrl", request.mediaUrls[0]),
    ...present("coverUrl", contentType === "reel" ? request.posterUrl : null),
    ...present("pageId", context.pageId),
    ...present("callbackUrl", context.callbackUrl),
    schema: MAKE_PAYLOAD_SCHEMA,
    attempt: request.attempt,
  });
  if (!parsed.success) throw new Error("MAKE_INVALID_PAYLOAD");
  return parsed.data;
}

/** A Facebook object id: digits, or a Page post id «PAGEID_POSTID». Never our own uuid. */
export const FACEBOOK_ID = /^\d{5,30}(_\d{5,30})?$/;

/**
 * Whether a Facebook id Make reported belongs to our Page. A text or image post id is
 * «PAGEID_POSTID», so its prefix names the Page. A Reel's video id carries no Page, so it cannot be
 * checked here and is accepted as it is.
 */
export function isOnPage(
  id: string,
  pageId: string,
  contentType: MakeContentType,
): boolean {
  if (contentType === "reel") return true;
  return id.startsWith(`${pageId}_`) && FACEBOOK_ID.test(id);
}

/**
 * Facebook's id from the scenario's 200 reply: facebookPostId for text and image, facebookObjectId
 * for a Reel, and only when valid. If the reply names a post or key, it must be ours.
 */
export function facebookIdFromReply(
  body: unknown,
  expected: {
    contentType: MakeContentType;
    postId: string;
    idempotencyKey: string;
  },
): string | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const reply = body as Record<string, unknown>;
  if (reply.postId !== undefined && reply.postId !== expected.postId)
    return null;
  if (
    reply.idempotencyKey !== undefined &&
    reply.idempotencyKey !== expected.idempotencyKey
  ) {
    return null;
  }
  const field =
    expected.contentType === "reel" ? "facebookObjectId" : "facebookPostId";
  const raw = reply[field];
  const value = typeof raw === "number" ? String(raw) : raw;
  return typeof value === "string" && FACEBOOK_ID.test(value.trim())
    ? value.trim()
    : null;
}

/** The callback the scenario may send later (POST /api/social/make/callback). */
export const makeCallbackSchema = z.object({
  schema: z.literal(MAKE_PAYLOAD_SCHEMA).optional(),
  post_id: z.uuid(),
  idempotency_key: z.string().regex(/^[0-9a-f]{64}$/),
  status: z.enum(["published", "failed", "partial"]),
  facebook_post_id: z.string().regex(FACEBOOK_ID).optional(),
  error: z.string().max(300).optional(),
});
export type MakeCallback = z.infer<typeof makeCallbackSchema>;
