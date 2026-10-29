/**
 * The render-only Reels worker. It renders the Reels the owner asked for in /admin/social/reels
 * and stores the videos. It holds no publishing, approval or social-account rights: it never
 * loads the social service, a publisher, Make or a Facebook token.
 *
 * Inert unless REELS_RENDER_WORKER is "on". Needs FFmpeg.
 *
 *   pnpm social:render-worker [limit]
 */
import { config } from "dotenv";

import { ReelRenderQueue } from "../src/features/social/application/reel-render-queue";
import { runReelRenders } from "../src/features/social/application/reel-render-worker";
import { httpCatalogSource } from "../src/features/social/infrastructure/catalog-source";
import { mediaStoreFromEnv } from "../src/features/social/infrastructure/media-store";
import { fetchImage } from "../src/features/social/infrastructure/render/brand";
import { renderStoryboard } from "../src/features/social/infrastructure/render/storyboard-video";
import { createDatabaseConnection } from "../src/server/db/database";

config({ path: ".env.local", quiet: true });

if (process.env.REELS_RENDER_WORKER !== "on") {
  console.log("Reels render worker is off (REELS_RENDER_WORKER is not 'on').");
  process.exit(0);
}
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
}
const limit = Math.min(Math.max(Number(process.argv[2] ?? 3) || 3, 1), 10);
// The same origin as the app's (social-factory is not imported: it wires the publishing service).
const origin = (
  process.env.SOCIAL_PUBLIC_ORIGIN ||
  process.env.APP_ORIGIN ||
  "http://localhost:3000"
).replace(/\/$/, "");
const siteLabel = (value: string) => value.replace(/^https?:\/\//, "");
const connection = createDatabaseConnection(databaseUrl, 2);
try {
  const summary = await runReelRenders(
    {
      queue: new ReelRenderQueue(connection.db),
      catalog: httpCatalogSource(process.env.SOCIAL_CATALOG_ORIGIN || origin),
      origin,
      siteLabel: siteLabel(origin),
      media: mediaStoreFromEnv({
        SUPABASE_URL: process.env.SUPABASE_URL,
        SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
      }),
      loadImage: fetchImage,
      render: renderStoryboard,
    },
    limit,
  );
  console.log(JSON.stringify(summary));
} finally {
  await connection.client.end({ timeout: 5 });
}
