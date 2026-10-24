import { z } from "zod";

import {
  classifyMetaError,
  MetaApiError,
} from "@/features/social/domain/meta-errors";

/**
 * The official Graph API for a Facebook Page, nothing else: no browser automation, no scraping.
 * Permissions used: pages_manage_posts (photos, Reels), pages_read_engagement and read_insights
 * (metrics), pages_read_user_content and pages_manage_engagement (comments).
 */
export const DEFAULT_GRAPH_VERSION = "v24.0";

export type FetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

export interface MetaClientConfig {
  pageId: string;
  pageToken: string;
  graphVersion?: string;
  fetch?: FetchLike;
  timeoutMs?: number;
}

export interface PublishedRef {
  /** The Page post id (PAGEID_POSTID) when Meta returns one. */
  postId: string | null;
  /** The photo or video object id. */
  objectId: string;
}

export interface PostEngagement {
  reactions: number;
  comments: number;
  shares: number;
  /** Reach and video views when the token has read_insights; null when Meta did not return them. */
  reach: number | null;
  views: number | null;
}

export interface PageComment {
  id: string;
  message: string;
  fromId: string | null;
  fromName: string | null;
  createdAt: string;
  parentId: string | null;
}

const errorBodySchema = z.object({
  error: z.object({
    code: z.number().optional(),
    error_subcode: z.number().optional(),
    is_transient: z.boolean().optional(),
  }),
});

export class MetaGraphClient {
  private readonly version: string;
  private readonly fetcher: FetchLike;
  private readonly timeoutMs: number;

  constructor(private readonly config: MetaClientConfig) {
    this.version = config.graphVersion ?? DEFAULT_GRAPH_VERSION;
    this.fetcher = config.fetch ?? ((input, init) => fetch(input, init));
    this.timeoutMs = config.timeoutMs ?? 30_000;
  }

  private graphUrl(path: string): string {
    return `https://graph.facebook.com/${this.version}/${path.replace(/^\//, "")}`;
  }

  private async call<T>(
    url: string,
    init: {
      method: "GET" | "POST";
      form?: Record<string, string>;
      headers?: Record<string, string>;
    },
    schema: z.ZodType<T>,
  ): Promise<T> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.config.pageToken}`,
      ...init.headers,
    };
    let response: Response;
    try {
      response = await this.fetcher(url, {
        method: init.method,
        headers: init.form
          ? { ...headers, "Content-Type": "application/x-www-form-urlencoded" }
          : headers,
        body: init.form ? new URLSearchParams(init.form).toString() : undefined,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new MetaApiError({ kind: "transient", code: null, subcode: null });
    }
    const text = await response.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    if (!response.ok) {
      const parsed = errorBodySchema.safeParse(body);
      const retryAfter = Number(response.headers.get("retry-after"));
      throw new MetaApiError(
        classifyMetaError({
          httpStatus: response.status,
          code: parsed.success ? parsed.data.error.code : null,
          subcode: parsed.success ? parsed.data.error.error_subcode : null,
          isTransient: parsed.success ? parsed.data.error.is_transient : false,
          retryAfterSeconds: Number.isFinite(retryAfter) ? retryAfter : null,
        }),
      );
    }
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      throw new MetaApiError({ kind: "unknown", code: null, subcode: null });
    }
    return parsed.data;
  }

  /** One photo with its caption, published now. Meta fetches the image from a public URL. */
  async publishPhoto(input: {
    imageUrl: string;
    caption: string;
  }): Promise<PublishedRef> {
    const result = await this.call(
      this.graphUrl(`${this.config.pageId}/photos`),
      {
        method: "POST",
        form: {
          url: input.imageUrl,
          message: input.caption,
          published: "true",
        },
      },
      z.object({ id: z.string(), post_id: z.string().optional() }),
    );
    return { objectId: result.id, postId: result.post_id ?? null };
  }

  /** Reels publishing: start an upload session, let Meta fetch the hosted MP4, then publish. */
  async publishReel(input: {
    videoUrl: string;
    caption: string;
  }): Promise<PublishedRef> {
    const start = await this.call(
      this.graphUrl(`${this.config.pageId}/video_reels`),
      { method: "POST", form: { upload_phase: "start" } },
      z.object({ video_id: z.string() }),
    );
    await this.call(
      `https://rupload.facebook.com/video-upload/${this.version}/${start.video_id}`,
      {
        method: "POST",
        headers: {
          Authorization: `OAuth ${this.config.pageToken}`,
          file_url: input.videoUrl,
        },
      },
      z.object({ success: z.boolean() }).loose(),
    );
    const finish = await this.call(
      this.graphUrl(`${this.config.pageId}/video_reels`),
      {
        method: "POST",
        form: {
          upload_phase: "finish",
          video_id: start.video_id,
          video_state: "PUBLISHED",
          description: input.caption,
        },
      },
      z
        .object({ success: z.boolean(), post_id: z.string().optional() })
        .loose(),
    );
    if (!finish.success) {
      throw new MetaApiError({ kind: "transient", code: null, subcode: null });
    }
    return { objectId: start.video_id, postId: finish.post_id ?? null };
  }

  /** Reel processing state: «ready», «processing» or «error». */
  async reelStatus(videoId: string): Promise<"ready" | "processing" | "error"> {
    const result = await this.call(
      this.graphUrl(`${videoId}?fields=status`),
      { method: "GET" },
      z
        .object({
          status: z
            .object({ video_status: z.string().optional() })
            .loose()
            .optional(),
        })
        .loose(),
    );
    const status = result.status?.video_status;
    if (status === "ready" || status === "published") return "ready";
    if (status === "error") return "error";
    return "processing";
  }

  /**
   * Posts on the Page since a moment, to find out whether a publish whose answer we lost
   * actually went through before sending it again.
   */
  async recentPosts(
    since: Date,
  ): Promise<Array<{ id: string; message: string }>> {
    const result = await this.call(
      this.graphUrl(
        `${this.config.pageId}/published_posts?fields=id,message&limit=25&since=${Math.floor(since.getTime() / 1000)}`,
      ),
      { method: "GET" },
      z.object({
        data: z.array(
          z.object({ id: z.string(), message: z.string().optional() }),
        ),
      }),
    );
    return result.data.map((post) => ({
      id: post.id,
      message: post.message ?? "",
    }));
  }

  async engagement(postId: string): Promise<PostEngagement> {
    const counts = await this.call(
      this.graphUrl(
        `${postId}?fields=shares,reactions.summary(total_count).limit(0),comments.summary(total_count).limit(0)`,
      ),
      { method: "GET" },
      z
        .object({
          shares: z.object({ count: z.number() }).optional(),
          reactions: z
            .object({ summary: z.object({ total_count: z.number() }) })
            .optional(),
          comments: z
            .object({ summary: z.object({ total_count: z.number() }) })
            .optional(),
        })
        .loose(),
    );
    let reach: number | null = null;
    let views: number | null = null;
    try {
      const insights = await this.call(
        this.graphUrl(
          `${postId}/insights?metric=post_impressions_unique,post_media_view`,
        ),
        { method: "GET" },
        z.object({
          data: z.array(
            z.object({
              name: z.string(),
              values: z.array(z.object({ value: z.unknown() })),
            }),
          ),
        }),
      );
      for (const metric of insights.data) {
        const value = metric.values[0]?.value;
        if (typeof value !== "number") continue;
        if (metric.name === "post_impressions_unique") reach = value;
        if (metric.name === "post_media_view") views = value;
      }
    } catch (error) {
      // Insights need read_insights; counts alone are still a useful report.
      if (!(error instanceof MetaApiError) || error.failure.kind === "auth")
        throw error;
    }
    return {
      reactions: counts.reactions?.summary.total_count ?? 0,
      comments: counts.comments?.summary.total_count ?? 0,
      shares: counts.shares?.count ?? 0,
      reach,
      views,
    };
  }

  async comments(postId: string): Promise<PageComment[]> {
    const result = await this.call(
      this.graphUrl(
        `${postId}/comments?filter=stream&order=reverse_chronological&limit=50&fields=id,message,from,created_time,parent`,
      ),
      { method: "GET" },
      z.object({
        data: z.array(
          z.object({
            id: z.string(),
            message: z.string().optional(),
            from: z
              .object({ id: z.string(), name: z.string().optional() })
              .optional(),
            created_time: z.string(),
            parent: z.object({ id: z.string() }).optional(),
          }),
        ),
      }),
    );
    return result.data.map((comment) => ({
      id: comment.id,
      message: comment.message ?? "",
      fromId: comment.from?.id ?? null,
      fromName: comment.from?.name ?? null,
      createdAt: comment.created_time,
      parentId: comment.parent?.id ?? null,
    }));
  }

  async replyToComment(commentId: string, message: string): Promise<string> {
    const result = await this.call(
      this.graphUrl(`${commentId}/comments`),
      { method: "POST", form: { message } },
      z.object({ id: z.string() }),
    );
    return result.id;
  }
}

export interface TokenInspection {
  valid: boolean;
  /** null when the token does not expire (a Page token from a long-lived user token or a system user). */
  expiresAt: Date | null;
  scopes: string[];
}

/** debug_token needs the app's own credentials; it tells us expiry and granted permissions. */
export async function inspectToken(input: {
  token: string;
  appId: string;
  appSecret: string;
  graphVersion?: string;
  fetch?: FetchLike;
}): Promise<TokenInspection> {
  const fetcher = input.fetch ?? ((url, init) => fetch(url, init));
  const params = new URLSearchParams({
    input_token: input.token,
    access_token: `${input.appId}|${input.appSecret}`,
  });
  const response = await fetcher(
    `https://graph.facebook.com/${input.graphVersion ?? DEFAULT_GRAPH_VERSION}/debug_token?${params}`,
    { signal: AbortSignal.timeout(15_000) },
  );
  if (!response.ok) {
    throw new MetaApiError(classifyMetaError({ httpStatus: response.status }));
  }
  const parsed = z
    .object({
      data: z.object({
        is_valid: z.boolean(),
        expires_at: z.number().optional(),
        scopes: z.array(z.string()).optional(),
      }),
    })
    .safeParse(await response.json());
  if (!parsed.success) {
    throw new MetaApiError({ kind: "unknown", code: null, subcode: null });
  }
  const expires = parsed.data.data.expires_at ?? 0;
  return {
    valid: parsed.data.data.is_valid,
    expiresAt: expires > 0 ? new Date(expires * 1000) : null,
    scopes: parsed.data.data.scopes ?? [],
  };
}

export const requiredPageScopes = [
  "pages_show_list",
  "pages_manage_posts",
  "pages_read_engagement",
  "pages_read_user_content",
  "pages_manage_engagement",
  "read_insights",
] as const;
