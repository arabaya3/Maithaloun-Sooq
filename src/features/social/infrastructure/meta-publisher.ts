import type {
  PageLookup,
  Publisher,
  PublishHooks,
  PublishOutcome,
  PublishRequest,
} from "@/features/social/domain/publisher";

import { sameCaption, type MetaGraphClient } from "./meta-graph-client";

/** The direct Graph API integration, unchanged in behaviour, behind the shared publisher interface. */
export class MetaPublisher implements Publisher {
  readonly name = "meta" as const;

  constructor(private readonly client: MetaGraphClient) {}

  supports(): boolean {
    return true;
  }

  async publish(
    request: PublishRequest,
    hooks: PublishHooks = {},
  ): Promise<PublishOutcome> {
    const mediaUrl = request.mediaUrls[0]!;
    const ref =
      request.format === "reel"
        ? await this.client.publishReel({
            videoUrl: mediaUrl,
            caption: request.caption,
            onUploadStarted: hooks.onUploadStarted,
          })
        : await this.client.publishPhoto({
            imageUrl: mediaUrl,
            caption: request.caption,
          });
    return { kind: "published", objectId: ref.objectId, postId: ref.postId };
  }

  /** A Reel is asked about by its own video id; a photo is found by its caption since approval. */
  async lookUp(post: {
    caption: string;
    uploadReference: string | null;
    since: Date;
  }): Promise<PageLookup> {
    if (post.uploadReference) {
      const state = await this.client.reelState(post.uploadReference);
      if (state === "published") return { state, id: post.uploadReference };
      if (state === "processing" || state === "failed") return { state };
      return { state: "absent" };
    }
    const found = (await this.client.recentContent(post.since)).find(
      (candidate) => sameCaption(candidate.message, post.caption),
    );
    return found ? { state: "published", id: found.id } : { state: "absent" };
  }
}
