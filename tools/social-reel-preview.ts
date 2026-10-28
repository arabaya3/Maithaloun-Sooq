/**
 * Renders the Reels Studio's concepts from the live catalog for review: an MP4 per Reel, a still
 * per scene and the storyboard as JSON. It reads the public catalog only; nothing is uploaded or
 * published. Needs FFmpeg.
 *
 *   pnpm social:reels [outDir]
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { config } from "dotenv";

import {
  siteLabel,
  socialOrigin,
} from "../src/features/social/application/social-factory";
import {
  buildStoryboard,
  type ReelConcept,
  type ReelLength,
} from "../src/features/social/domain/reels";
import { httpCatalogSource } from "../src/features/social/infrastructure/catalog-source";
import { fetchImage } from "../src/features/social/infrastructure/render/brand";
import { renderStoryboard } from "../src/features/social/infrastructure/render/storyboard-video";

config({ path: ".env.local", quiet: true });

const origin = socialOrigin({
  SOCIAL_PUBLIC_ORIGIN:
    process.env.SOCIAL_PUBLIC_ORIGIN || "https://www.maytha.app",
});
const outDir = path.resolve(
  process.argv[2] ?? path.join("artifacts", "social", "reels"),
);
const catalog = await httpCatalogSource(
  process.env.SOCIAL_CATALOG_ORIGIN || origin,
)();
await mkdir(outDir, { recursive: true });

// A laundry product for the problem-to-product Reel: the most common household need.
const laundry =
  catalog.products.find((product) => product.categoryCode === "laundry") ??
  catalog.products[0]!;
const reels: Array<{ concept: ReelConcept; seconds: ReelLength }> = [
  { concept: "meet-meetho", seconds: 10 },
  { concept: "problem-to-product", seconds: 15 },
  { concept: "delivery-explainer", seconds: 15 },
];
for (const { concept, seconds } of reels) {
  const board = buildStoryboard({
    concept,
    seconds,
    products: concept === "problem-to-product" ? [laundry] : [],
    store: catalog.store,
    origin,
  });
  const photos = new Map<string, Buffer>();
  for (const id of board.productIds) {
    const product = catalog.products.find((item) => item.id === id)!;
    photos.set(id, await fetchImage(product.imageUrl));
  }
  const rendered = await renderStoryboard({
    board,
    photos,
    store: catalog.store,
    siteLabel: siteLabel(origin),
  });
  await writeFile(path.join(outDir, `${concept}.mp4`), rendered.mp4);
  for (const [index, frame] of rendered.frames.entries()) {
    await writeFile(
      path.join(outDir, `${concept}-scene-${index + 1}.jpg`),
      frame,
    );
  }
  await writeFile(
    path.join(outDir, `${concept}.json`),
    JSON.stringify(board, null, 2),
  );
  console.log(
    `${concept}: ${board.scenes.length} scenes, ${rendered.seconds.toFixed(1)} s, ${(rendered.mp4.byteLength / 1024).toFixed(0)} KB`,
  );
}
