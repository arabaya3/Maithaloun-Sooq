import {
  buildStoryboard,
  type ReelConcept,
  type ReelLength,
  type Storyboard,
} from "@/features/social/domain/reels";
import type { SocialCatalog } from "@/features/social/domain/social-catalog";
import type { CatalogSource } from "@/features/social/infrastructure/catalog-source";
import type { SocialMediaStore } from "@/features/social/infrastructure/media-store";
import type {
  RenderedStory,
  StoryRenderInput,
} from "@/features/social/infrastructure/render/storyboard-video";

import {
  ReelRenderQueue,
  storyboardKey,
  type ReelChoices,
  type ReelRenderRow,
} from "./reel-render-queue";

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

/**
 * A requested Reel rebuilt from a given catalog with the owner's choices. Throws
 * PRODUCT_UNAVAILABLE when a product left the catalog and CATALOG_CHANGED when a price or a
 * store fact it shows is no longer true: a Reel is never drawn, kept or handed out with old prices.
 */
export function currentStoryboard(
  render: Pick<
    ReelRenderRow,
    "concept" | "seconds" | "productIds" | "storyboard" | "storyboardKey"
  >,
  catalog: SocialCatalog,
  origin: string,
): Storyboard {
  const stored = render.storyboard as unknown as Storyboard & {
    choices?: ReelChoices;
  };
  const products = render.productIds.map((id) =>
    catalog.products.find((product) => product.id === id),
  );
  if (products.some((product) => !product)) {
    throw new Error("PRODUCT_UNAVAILABLE");
  }
  const board = buildStoryboard({
    concept: render.concept as ReelConcept,
    seconds: render.seconds as ReelLength,
    products: products as NonNullable<(typeof products)[number]>[],
    store: catalog.store,
    origin,
    ...(stored.choices ?? {}),
  });
  if (storyboardKey(board) !== render.storyboardKey) {
    throw new Error("CATALOG_CHANGED");
  }
  return board;
}

export async function runReelRenders(
  deps: ReelRenderDeps,
  limit = 3,
): Promise<ReelRenderSummary> {
  const summary: ReelRenderSummary = { rendered: 0, failed: 0 };
  // Without the catalog nothing can be checked: nothing is claimed, so no try is spent.
  await deps.catalog();
  for (let count = 0; count < limit; count += 1) {
    const claimed = await deps.queue.claim();
    if (!claimed) break;
    const { render, token } = claimed;
    try {
      // Checked against the catalog before drawing and again after: a price that changes while
      // FFmpeg runs throws the video away instead of storing it.
      const catalog = await deps.catalog();
      const board = currentStoryboard(render, catalog, deps.origin);
      const photos = new Map<string, Buffer>();
      for (const id of board.productIds) {
        const product = catalog.products.find((item) => item.id === id)!;
        photos.set(id, await deps.loadImage(product.imageUrl));
      }
      const result = await deps.render({
        board,
        photos,
        store: catalog.store,
        siteLabel: deps.siteLabel,
      });
      currentStoryboard(render, await deps.catalog(), deps.origin);
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
      // The catalog went away mid-run: stop, rather than spend every try of the next render.
      if (code === "CATALOG_UNAVAILABLE") break;
    }
  }
  return summary;
}
