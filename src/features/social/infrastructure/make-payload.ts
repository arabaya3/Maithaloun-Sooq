import { z } from "zod";

import type { PublishRequest } from "@/features/social/domain/publisher";

/**
 * The one place that knows the shape of the request sent to the Make scenario and of its reply.
 *
 * Confirmed with the configured scenario («MAYTHA Social Publish»): API-key webhook (x-make-apikey);
 * `contentType` is text, image (exactly one image) or reel; success is HTTP 200 carrying the Facebook
 * object id; unsupported content is HTTP 422; a Facebook module failure is HTTP 502.
 *
 * NOT YET CONFIRMED: the names of the other request fields and of the id field in the 200 reply.
 * They are set here only; a mismatch makes the scenario answer 422 (nothing published) or makes a
 * 200 unreadable (kept as «awaiting confirmation», never retried).
 */
export const MAKE_PAYLOAD_SCHEMA = "maytha.social-post.v1";

export const makeContentTypes = ["text", "image", "reel"] as const;
export type MakeContentType = (typeof makeContentTypes)[number];

export interface MakePayload {
  schema: typeof MAKE_PAYLOAD_SCHEMA;
  postId: string;
  idempotencyKey: string;
  attempt: number;
  contentType: MakeContentType;
  /** The approved caption exactly as approved, UTF-8 Arabic, never rewritten. */
  caption: string;
  /** The single image (image) or video (reel); null for text. */
  mediaUrl: string | null;
  coverUrl: string | null;
  pageId: string | null;
  /** Where the scenario may report Facebook's result later; null when no callback is configured. */
  callbackUrl: string | null;
}

/** The scenario takes exactly one image; anything else is refused here, before any call to Make. */
export function contentTypeOf(request: PublishRequest): MakeContentType | null {
  if (request.format === "reel") {
    return request.mediaUrls.length === 1 ? "reel" : null;
  }
  if (request.mediaUrls.length === 0) return "text";
  return request.mediaUrls.length === 1 ? "image" : null;
}

export function buildMakePayload(
  request: PublishRequest,
  context: { pageId: string | null; callbackUrl: string | null },
): MakePayload {
  const contentType = contentTypeOf(request);
  if (!contentType) throw new Error("MAKE_UNSUPPORTED_CONTENT");
  return {
    schema: MAKE_PAYLOAD_SCHEMA,
    postId: request.postId,
    idempotencyKey: request.idempotencyKey,
    attempt: request.attempt,
    contentType,
    caption: request.caption,
    mediaUrl: request.mediaUrls[0] ?? null,
    coverUrl: request.format === "reel" ? request.posterUrl : null,
    pageId: context.pageId,
    callbackUrl: context.callbackUrl,
  };
}

/** A Facebook object id: digits, or a Page post id «PAGEID_POSTID». Never our own uuid. */
export const FACEBOOK_ID = /^\d{5,30}(_\d{5,30})?$/;

const idFields = [
  "facebookObjectId",
  "facebookPostId",
  "facebook_post_id",
  "objectId",
  "id",
] as const;

/**
 * Facebook's id from the scenario's 200 reply, only when exactly one candidate field carries a
 * valid Facebook id. Anything else (missing, malformed, conflicting) is not a confirmation.
 */
export function facebookIdFromReply(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const found = new Set<string>();
  for (const field of idFields) {
    const value = (body as Record<string, unknown>)[field];
    const text = typeof value === "number" ? String(value) : value;
    if (typeof text === "string" && FACEBOOK_ID.test(text.trim())) {
      found.add(text.trim());
    }
  }
  return found.size === 1 ? [...found][0]! : null;
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
