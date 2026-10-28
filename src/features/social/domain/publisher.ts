import type { PostFormat } from "./post-lifecycle";

/**
 * Where approved posts go. Every provider sits behind the same approval gate, claim lock and
 * reconciliation; a provider only knows how to hand one approved post over.
 */
export const publisherNames = ["meta", "make"] as const;
export type PublisherName = (typeof publisherNames)[number];

export interface PublishRequest {
  /** Our post id; the provider echoes it back so a confirmation can be matched. */
  postId: string;
  /** The approval's content hash; the same approved content always carries the same key. */
  idempotencyKey: string;
  format: PostFormat;
  kind: string;
  caption: string;
  mediaUrls: string[];
  posterUrl: string | null;
  attempt: number;
}

export type PublishOutcome =
  /** Facebook confirmed the post. */
  | { kind: "published"; objectId: string; postId: string | null }
  /** Handed over (Make took the request); whether Facebook published it is not known yet. */
  | {
      kind: "accepted";
      reference: string | null;
      /** Make named a post on another Page: it may be live, but not on ours. */
      problem?: "page_mismatch";
    };

export type PageLookup =
  | { state: "published"; id: string }
  | { state: "processing" | "failed" | "absent" };

export interface PublishHooks {
  /** Called before anything can become public, with an id that lets us ask about it later. */
  onUploadStarted?: (reference: string) => Promise<void>;
}

export interface Publisher {
  readonly name: PublisherName;
  /** The Page this publisher must post to, when it is configured. */
  readonly pageId?: string | null;
  supports(format: PostFormat): boolean;
  /**
   * Throws a MetaApiError-style failure. «unknown_outcome» means the request may have taken effect
   * and must never be retried before someone has checked the Page.
   */
  publish(
    request: PublishRequest,
    hooks?: PublishHooks,
  ): Promise<PublishOutcome>;
  /** Present only when the provider can check the Page itself (Meta Graph API). */
  lookUp?(post: {
    caption: string;
    uploadReference: string | null;
    since: Date;
  }): Promise<PageLookup>;
}

/** «SOCIAL_PUBLISHER»: meta (default, the existing direct integration) or make. */
export function choosePublisherName(raw: string | undefined): PublisherName {
  return raw === "make" ? "make" : "meta";
}
