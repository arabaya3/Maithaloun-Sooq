import { MetaApiError } from "@/features/social/domain/meta-errors";
import type { PostFormat } from "@/features/social/domain/post-lifecycle";
import type {
  Publisher,
  PublishOutcome,
  PublishRequest,
} from "@/features/social/domain/publisher";

import {
  buildMakePayload,
  contentTypeOf,
  facebookIdFromReply,
} from "./make-payload";
import type { FetchLike } from "./meta-graph-client";

export interface MakePublisherConfig {
  webhookUrl: string;
  apiKey: string;
  /** Reels go to Make only when its scenario is confirmed to publish them. */
  supportsReels: boolean;
  pageId: string | null;
  callbackUrl: string | null;
  fetch?: FetchLike;
  timeoutMs?: number;
}

const fail = (
  kind: MetaApiError["failure"]["kind"],
  code: number | null = null,
) => new MetaApiError({ kind, code, subcode: null });

/**
 * Hands one approved post to the Make scenario, server-side only. A 2xx answer means Make took the
 * request; Facebook's result is known only when the scenario says so explicitly (in its reply or
 * through the callback). Anything ambiguous is «unknown_outcome», which is never retried blindly.
 */
export class MakePublisher implements Publisher {
  readonly name = "make" as const;
  private readonly fetcher: FetchLike;

  constructor(private readonly config: MakePublisherConfig) {
    this.fetcher = config.fetch ?? ((url, init) => fetch(url, init));
  }

  supports(format: PostFormat): boolean {
    return format !== "reel" || this.config.supportsReels;
  }

  async publish(request: PublishRequest): Promise<PublishOutcome> {
    // Refused here, before any call: Reels not enabled, or more than one image.
    if (!this.supports(request.format) || !contentTypeOf(request)) {
      throw fail("invalid_request");
    }
    let body: string;
    try {
      body = JSON.stringify(
        buildMakePayload(request, {
          pageId: this.config.pageId,
          callbackUrl: this.config.callbackUrl,
        }),
      );
    } catch {
      // The payload does not fit the scenario's schema: refused here, nothing was sent.
      throw fail("invalid_request");
    }
    let response: Response;
    try {
      response = await this.fetcher(this.config.webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "x-make-apikey": this.config.apiKey,
          "Idempotency-Key": request.idempotencyKey,
        },
        body,
        signal: AbortSignal.timeout(this.config.timeoutMs ?? 20_000),
      });
    } catch {
      // The request may have reached Make before the connection failed.
      throw fail("unknown_outcome");
    }
    let text = "";
    try {
      text = await response.text();
    } catch {
      if (response.ok) throw fail("unknown_outcome");
    }

    if (!response.ok) {
      // Refused before the scenario ran: nothing can have been published.
      if (response.status === 401 || response.status === 403) {
        throw fail("auth", response.status);
      }
      if (response.status === 429) throw fail("rate_limit", 429);
      // 422: the scenario refused the content before its Facebook module ran.
      if (response.status >= 400 && response.status < 500) {
        throw fail("invalid_request", response.status);
      }
      // 502 is the scenario's «Facebook module failed», but a gateway 502 looks the same, and a
      // Facebook failure can follow a partial publish: never assume nothing went out.
      throw fail("unknown_outcome", response.status);
    }

    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    // Published only with a valid Facebook object id; a 200 without one (Make's plain «Accepted»,
    // an unexpected body) waits for confirmation and is never re-sent automatically.
    const facebookId = facebookIdFromReply(json, {
      contentType: contentTypeOf(request)!,
      postId: request.postId,
      idempotencyKey: request.idempotencyKey,
    });
    if (facebookId) {
      return { kind: "published", objectId: facebookId, postId: facebookId };
    }
    return { kind: "accepted", reference: null };
  }
}

export interface MakeEnvironment {
  [key: string]: string | undefined;
  MAKE_WEBHOOK_URL?: string;
  MAKE_WEBHOOK_API_KEY?: string;
  MAKE_SUPPORTS_REELS?: string;
  MAKE_CALLBACK_SECRET?: string;
}

/** Make is usable only with an https webhook on Make's own hosts and a real API key. */
export function makeConfigProblems(env: MakeEnvironment): string[] {
  const problems: string[] = [];
  let url: URL | null = null;
  try {
    url = env.MAKE_WEBHOOK_URL ? new URL(env.MAKE_WEBHOOK_URL) : null;
  } catch {
    url = null;
  }
  if (!url) problems.push("MAKE_WEBHOOK_URL");
  else if (
    url.protocol !== "https:" ||
    !/(^|\.)make\.com$/.test(url.hostname)
  ) {
    problems.push("MAKE_WEBHOOK_URL_HOST");
  }
  if (!env.MAKE_WEBHOOK_API_KEY || env.MAKE_WEBHOOK_API_KEY.length < 16) {
    problems.push("MAKE_WEBHOOK_API_KEY");
  }
  return problems;
}

export function makeCallbackSecret(env: MakeEnvironment): string | null {
  const secret = env.MAKE_CALLBACK_SECRET?.trim();
  return secret && secret.length >= 32 ? secret : null;
}
