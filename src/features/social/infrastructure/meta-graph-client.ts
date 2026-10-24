import { createHmac } from "node:crypto";

import { z } from "zod";

import {
  classifyMetaError,
  MetaApiError,
} from "@/features/social/domain/meta-errors";

/**
 * The official Graph API for a Facebook Page, nothing else: no browser automation, no scraping.
 * Permissions used: pages_manage_posts (photos, Reels), pages_read_engagement and read_insights
 * (metrics), pages_read_user_content and pages_manage_engagement (comments).
 * v25.0 is supported until July 2028 (Graph API changelog).
 */
export const DEFAULT_GRAPH_VERSION = "v25.0";

export type FetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

export interface MetaClientConfig {
  pageId: string;
  pageToken: string;
  /** When set, every call carries appsecret_proof (Meta's "Require App Secret" setting). */
  appSecret?: string;
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
  /** Unique viewers and views when the token has read_insights; null when Meta did not return them. */
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

export type ReelState = "published" | "processing" | "failed" | "not_published";

const errorBodySchema = z.object({
  error: z.object({
    code: z.number().optional(),
    error_subcode: z.number().optional(),
    is_transient: z.boolean().optional(),
  }),
});

export function appSecretProof(token: string, appSecret: string): string {
  return createHmac("sha256", appSecret).update(token).digest("hex");
}

/** Facebook may tidy whitespace in a caption; compare captions the way a person would read them. */
export function sameCaption(a: string, b: string): boolean {
  const normalize = (value: string) => value.replace(/\s+/g, " ").trim();
  return normalize(a) === normalize(b);
}

const unknownOutcome = () =>
  new MetaApiError({ kind: "unknown_outcome", code: null, subcode: null });

export class MetaGraphClient {
  private readonly version: string;
  private readonly fetcher: FetchLike;
  private readonly timeoutMs: number;

  constructor(private readonly config: MetaClientConfig) {
    this.version = config.graphVersion ?? DEFAULT_GRAPH_VERSION;
    this.fetcher = config.fetch ?? ((input, init) => fetch(input, init));
    this.timeoutMs = config.timeoutMs ?? 20_000;
  }

  private graphUrl(path: string): string {
    const url = new URL(
      `https://graph.facebook.com/${this.version}/${path.replace(/^\//, "")}`,
    );
    if (this.config.appSecret) {
      url.searchParams.set(
        "appsecret_proof",
        appSecretProof(this.config.pageToken, this.config.appSecret),
      );
    }
    return url.toString();
  }

  /**
   * `publishes` marks the one request that makes content public. When its answer is lost (timeout,
   * dropped connection, 5xx, unreadable body) Meta may still have published it, so the failure is
   * «unknown_outcome», which is never retried blindly: the Page is checked first.
   */
  private async call<T>(
    url: string,
    init: {
      method: "GET" | "POST";
      form?: Record<string, string>;
      headers?: Record<string, string>;
      publishes?: boolean;
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
      if (init.publishes) throw unknownOutcome();
      throw new MetaApiError({ kind: "transient", code: null, subcode: null });
    }
    let text = "";
    try {
      text = await response.text();
    } catch {
      if (init.publishes && response.ok) throw unknownOutcome();
    }
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    if (!response.ok) {
      const parsed = errorBodySchema.safeParse(body);
      // A gateway error says nothing about whether Meta acted on the request.
      if (init.publishes && response.status >= 500 && !parsed.success) {
        throw unknownOutcome();
      }
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
      if (init.publishes) throw unknownOutcome();
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
        publishes: true,
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

  /**
   * Reels publishing: start an upload session, let Meta fetch the hosted MP4, then publish.
   * `onUploadStarted` stores the video id before anything can become public, so a lost answer
   * to the final step is resolved by asking about that exact video instead of uploading again.
   */
  async publishReel(input: {
    videoUrl: string;
    caption: string;
    onUploadStarted?: (videoId: string) => Promise<void>;
  }): Promise<PublishedRef> {
    const start = await this.call(
      this.graphUrl(`${this.config.pageId}/video_reels`),
      { method: "POST", form: { upload_phase: "start" } },
      z.object({ video_id: z.string() }),
    );
    await input.onUploadStarted?.(start.video_id);
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
        publishes: true,
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
    if (!finish.success) throw unknownOutcome();
    return { objectId: start.video_id, postId: finish.post_id ?? null };
  }

  /** Where a Reel stands, from its uploading, processing and publishing phases. */
  async reelState(videoId: string): Promise<ReelState> {
    const phase = z
      .object({ status: z.string().optional() })
      .loose()
      .optional();
    const result = await this.call(
      this.graphUrl(`${videoId}?fields=status`),
      { method: "GET" },
      z
        .object({
          status: z
            .object({
              video_status: z.string().optional(),
              uploading_phase: phase,
              processing_phase: phase,
              publishing_phase: phase,
            })
            .loose()
            .optional(),
        })
        .loose(),
    );
    const status = result.status;
    const done = (value?: string) =>
      value === "complete" || value === "completed";
    if (
      status?.video_status === "error" ||
      [
        status?.uploading_phase,
        status?.processing_phase,
        status?.publishing_phase,
      ].some((item) => item?.status === "error")
    ) {
      return "failed";
    }
    if (done(status?.publishing_phase?.status)) return "published";
    if (
      status?.publishing_phase?.status === "not_started" &&
      !done(status?.uploading_phase?.status)
    ) {
      return "not_published";
    }
    return "processing";
  }

  /**
   * The Page's recent posts and photos since a moment, to find out whether a publish whose
   * answer we lost actually went through before anything is sent again.
   */
  async recentContent(
    since: Date,
  ): Promise<Array<{ id: string; message: string }>> {
    const sinceSeconds = Math.floor(since.getTime() / 1000);
    const list = z.object({
      data: z.array(
        z.object({
          id: z.string(),
          message: z.string().optional(),
          name: z.string().optional(),
        }),
      ),
    });
    const [posts, photos] = await Promise.all([
      this.call(
        this.graphUrl(
          `${this.config.pageId}/published_posts?fields=id,message&limit=100&since=${sinceSeconds}`,
        ),
        { method: "GET" },
        list,
      ),
      this.call(
        this.graphUrl(
          `${this.config.pageId}/photos?type=uploaded&fields=id,name&limit=100&since=${sinceSeconds}`,
        ),
        { method: "GET" },
        list,
      ),
    ]);
    return [...posts.data, ...photos.data].map((item) => ({
      id: item.id,
      message: item.message ?? item.name ?? "",
    }));
  }

  private async insights(
    path: string,
    names: Record<string, "reach" | "views">,
  ): Promise<{ reach: number | null; views: number | null }> {
    const values = {
      reach: null as number | null,
      views: null as number | null,
    };
    try {
      const insights = await this.call(
        this.graphUrl(`${path}?metric=${Object.keys(names).join(",")}`),
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
        const key = names[metric.name];
        if (key && typeof value === "number") values[key] = value;
      }
    } catch (error) {
      // Insights need read_insights; counts alone are still a useful report.
      if (!(error instanceof MetaApiError) || error.failure.kind === "auth") {
        throw error;
      }
    }
    return values;
  }

  /** Reactions, comments and shares, plus views: post insights for photos, Reels insights for videos. */
  async engagement(
    postId: string,
    reelVideoId?: string | null,
  ): Promise<PostEngagement> {
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
    const views = reelVideoId
      ? await this.insights(`${reelVideoId}/video_insights`, {
          post_impressions_unique: "reach",
          fb_reels_total_plays: "views",
        })
      : await this.insights(`${postId}/insights`, {
          post_total_media_view_unique: "reach",
          post_media_view: "views",
        });
    return {
      reactions: counts.reactions?.summary.total_count ?? 0,
      comments: counts.comments?.summary.total_count ?? 0,
      shares: counts.shares?.count ?? 0,
      ...views,
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
      { method: "POST", publishes: true, form: { message } },
      z.object({ id: z.string() }),
    );
    return result.id;
  }
}

export interface TokenInspection {
  valid: boolean;
  /** null when the token does not expire (a Page token from a long-lived user token or a system user). */
  expiresAt: Date | null;
  /** When Meta stops returning user data unless the owner signs in again (90 days of inactivity). */
  dataAccessExpiresAt: Date | null;
  scopes: string[];
  appId: string | null;
  /** For a Page token, the Page it belongs to. */
  profileId: string | null;
}

/** debug_token needs the app's own credentials; it tells us expiry, permissions and what the token is for. */
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
        app_id: z.string().optional(),
        profile_id: z.string().optional(),
        expires_at: z.number().optional(),
        data_access_expires_at: z.number().optional(),
        scopes: z.array(z.string()).optional(),
      }),
    })
    .safeParse(await response.json());
  if (!parsed.success) {
    throw new MetaApiError({ kind: "unknown", code: null, subcode: null });
  }
  const data = parsed.data.data;
  const toDate = (seconds?: number) =>
    seconds && seconds > 0 ? new Date(seconds * 1000) : null;
  return {
    valid: data.is_valid,
    expiresAt: toDate(data.expires_at),
    dataAccessExpiresAt: toDate(data.data_access_expires_at),
    scopes: data.scopes ?? [],
    appId: data.app_id ?? null,
    profileId: data.profile_id ?? null,
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

/** A token is usable only for our app, our Page, and with every permission the manager needs. */
export function tokenProblems(
  inspection: TokenInspection,
  expected: { appId: string; pageId: string },
): Array<"invalid" | "wrong_app" | "wrong_page" | "missing_scopes"> {
  const problems: Array<
    "invalid" | "wrong_app" | "wrong_page" | "missing_scopes"
  > = [];
  if (!inspection.valid) problems.push("invalid");
  if (inspection.appId && inspection.appId !== expected.appId)
    problems.push("wrong_app");
  if (inspection.profileId && inspection.profileId !== expected.pageId)
    problems.push("wrong_page");
  if (requiredPageScopes.some((scope) => !inspection.scopes.includes(scope))) {
    problems.push("missing_scopes");
  }
  return problems;
}
