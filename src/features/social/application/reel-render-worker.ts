import {
  buildStoryboard,
  type ReelConcept,
  type ReelLength,
  type Storyboard,
} from "@/features/social/domain/reels";
import type { CatalogSource } from "@/features/social/infrastructure/catalog-source";
import type { SocialMediaStore } from "@/features/social/infrastructure/media-store";
import type {
  RenderedStory,
  StoryRenderInput,
} from "@/features/social/infrastructure/render/storyboard-video";

import { ReelRenderQueue, storyboardKey } from "./reel-render-queue";

/**
 * The render-only worker's job: render what the owner asked for and store the video. It has no
 * publisher, no social account and no approval rights; the result is a file on the dashboard.
 */
export interface ReelRenderDeps {
  queue: ReelRenderQueue;
  catalog: CatalogSource;
  origin: string;
  siteLabel: string;
  media: SocialMediaStore;
  loadImage: (url: string) => Promise<Buffer>;
  render: (input: StoryRenderInput) => Promise<RenderedStory>;
}

export interface ReelRenderSummary {
  rendered: number;
  failed: number;
}

/** Failures another try cannot fix: the owner makes a new Reel from today's catalog instead. */
const FINAL = new Set(["CATALOG_CHANGED", "PRODUCT_UNAVAILABLE"]);

function failure(error: unknown): string {
  return error instanceof Error && /^[A-Z_]{3,40}$/.test(error.message)
    ? error.message
    : "RENDER_FAILED";
}

export async function runReelRenders(
  deps: ReelRenderDeps,
  limit = 3,
): Promise<ReelRenderSummary> {
  const summary: ReelRenderSummary = { rendered: 0, failed: 0 };
  const catalog = await deps.catalog();
  for (let count = 0; count < limit; count += 1) {
    const claimed = await deps.queue.claim();
    if (!claimed) break;
    const { render, token } = claimed;
    try {
      const stored = render.storyboard as unknown as Storyboard & {
        dropScenes?: number[];
      };
      const products = render.productIds.map((id) =>
        catalog.products.find((product) => product.id === id),
      );
      if (products.some((product) => !product)) {
        throw new Error("PRODUCT_UNAVAILABLE");
      }
      // Rebuilt from today's catalog: a Reel is never drawn with yesterday's prices.
      const board = buildStoryboard({
        concept: render.concept as ReelConcept,
        seconds: render.seconds as ReelLength,
        products: products as NonNullable<(typeof products)[number]>[],
        store: catalog.store,
        origin: deps.origin,
        dropScenes: stored.dropScenes ?? [],
      });
      if (storyboardKey(board) !== render.storyboardKey) {
        throw new Error("CATALOG_CHANGED");
      }
      const photos = new Map<string, Buffer>();
      for (const product of products) {
        photos.set(product!.id, await deps.loadImage(product!.imageUrl));
      }
      const result = await deps.render({
        board,
        photos,
        store: catalog.store,
        siteLabel: deps.siteLabel,
      });
      let videoUrl: string;
      const frameUrls: string[] = [];
      try {
        videoUrl = await deps.media.put(result.mp4, "mp4");
        for (const frame of result.frames) {
          frameUrls.push(await deps.media.put(frame, "jpg"));
        }
      } catch {
        throw new Error("UPLOAD_FAILED");
      }
      await deps.queue.finish(render.id, token, {
        videoUrl,
        frameUrls,
        seconds: result.seconds,
      });
      summary.rendered += 1;
    } catch (error) {
      const code = failure(error);
      await deps.queue.fail(render.id, token, code, FINAL.has(code));
      summary.failed += 1;
    }
  }
  return summary;
}
