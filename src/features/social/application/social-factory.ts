import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import type { CatalogSource } from "@/features/social/infrastructure/catalog-source";
import { mediaStoreFromEnv } from "@/features/social/infrastructure/media-store";
import { fetchImage } from "@/features/social/infrastructure/render/brand";
import { renderFeedImage } from "@/features/social/infrastructure/render/image-templates";
import {
  isFfmpegAvailable,
  renderReel,
} from "@/features/social/infrastructure/render/reel-templates";
import { parseVaultKey } from "@/features/social/infrastructure/token-vault";
import type * as schema from "@/server/db/schema";

import { SocialService, type CaptionWriter } from "./social-service";

export interface SocialEnvironment {
  [key: string]: string | undefined;
  SOCIAL_MANAGER?: string;
  SOCIAL_TOKEN_KEY?: string;
  SOCIAL_PUBLIC_ORIGIN?: string;
  APP_ORIGIN?: string;
  META_APP_ID?: string;
  META_APP_SECRET?: string;
  META_GRAPH_VERSION?: string;
  SUPABASE_URL?: string;
  SUPABASE_SECRET_KEY?: string;
}

/** Off unless switched on, so merging this feature changes nothing for the live store. */
export function isSocialManagerEnabled(env: SocialEnvironment): boolean {
  return env.SOCIAL_MANAGER === "on";
}

export function socialOrigin(env: SocialEnvironment): string {
  return (
    env.SOCIAL_PUBLIC_ORIGIN ||
    env.APP_ORIGIN ||
    "http://localhost:3000"
  ).replace(/\/$/, "");
}

export function siteLabel(origin: string): string {
  return origin.replace(/^https?:\/\//, "");
}

/** One wiring for the app and the render worker; only the catalog source and the AI writer differ. */
export function createSocialService(input: {
  env: SocialEnvironment;
  database: PostgresJsDatabase<typeof schema>;
  catalog: CatalogSource;
  captionWriter?: CaptionWriter | null;
}): SocialService {
  const origin = socialOrigin(input.env);
  const label = siteLabel(origin);
  return new SocialService({
    database: input.database,
    catalog: input.catalog,
    media: mediaStoreFromEnv(input.env),
    origin,
    vaultKey: () => parseVaultKey(input.env.SOCIAL_TOKEN_KEY),
    metaApp:
      input.env.META_APP_ID && input.env.META_APP_SECRET
        ? { appId: input.env.META_APP_ID, appSecret: input.env.META_APP_SECRET }
        : null,
    graphVersion: input.env.META_GRAPH_VERSION || undefined,
    loadImage: fetchImage,
    renderFeed: ({ kind, products, photos, catalog, tipId, categoryName }) =>
      renderFeedImage({
        kind,
        products,
        photos,
        store: catalog.store,
        siteLabel: label,
        tipId,
        categoryName,
      }),
    renderReel: ({ template, products, photos, catalog }) =>
      renderReel({
        template,
        products,
        photos,
        store: catalog.store,
        siteLabel: label,
      }),
    videoRenderingAvailable: isFfmpegAvailable,
    captionWriter: input.captionWriter ?? null,
  });
}
