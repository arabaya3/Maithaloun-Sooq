import "server-only";

import { httpCatalogSource } from "@/features/social/infrastructure/catalog-source";
import { appCatalogSource } from "@/features/social/infrastructure/catalog-source-app";
import { db } from "@/server/db/db";
import { lazyObject } from "@/server/lazy-object";

import { aiCaptionWriter } from "./caption-writer";
import { createSocialService, isSocialManagerEnabled } from "./social-factory";
import { SocialJobs } from "./social-jobs";

export function socialEnabled(): boolean {
  return isSocialManagerEnabled(process.env);
}

export const socialService = lazyObject(() =>
  createSocialService({
    env: process.env,
    database: db,
    // A preview deployment or local setup can read the live store's public catalog instead of its own.
    catalog: process.env.SOCIAL_CATALOG_ORIGIN
      ? httpCatalogSource(process.env.SOCIAL_CATALOG_ORIGIN)
      : appCatalogSource,
    captionWriter:
      process.env.SOCIAL_AI_CAPTIONS === "on"
        ? aiCaptionWriter(process.env.OPENAI_TEXT_MODEL || "gpt-4.1-mini")
        : null,
  }),
);

export const socialJobs = lazyObject(() => new SocialJobs(db, socialService));
