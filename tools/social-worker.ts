/**
 * The social render-and-publish worker. Vercel functions have no FFmpeg, so Reels are rendered here
 * (locally or on the free GitHub Actions schedule) and published by the same approval-gated service.
 *
 *   pnpm social:worker            render pending media, then publish what is due
 *   pnpm social:worker daily      the daily jobs (drafts, metrics, comments, token check)
 *   pnpm social:worker <job>      one job: discover|draft|render|publish|reconcile|engagement|comments|connection|report
 *   pnpm social:worker publish-one <post-id> --confirm
 *                                 publish exactly this approved post now (controlled live test)
 */
import { config } from "dotenv";

import {
  createSocialService,
  isSocialManagerEnabled,
  socialOrigin,
} from "../src/features/social/application/social-factory";
import {
  SocialJobs,
  socialJobNames,
  type SocialJobName,
} from "../src/features/social/application/social-jobs";
import { httpCatalogSource } from "../src/features/social/infrastructure/catalog-source";
import { createDatabaseConnection } from "../src/server/db/database";

config({ path: ".env.local", quiet: true });

if (!isSocialManagerEnabled(process.env)) {
  console.log(
    "Social manager is off (SOCIAL_MANAGER is not 'on'); nothing to do.",
  );
  process.exit(0);
}
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
}

const command = process.argv[2] ?? "default";
const connection = createDatabaseConnection(databaseUrl, 2);
const catalogOrigin =
  process.env.SOCIAL_CATALOG_ORIGIN || socialOrigin(process.env);
const service = createSocialService({
  env: process.env,
  database: connection.db,
  catalog: httpCatalogSource(catalogOrigin),
});
const jobs = new SocialJobs(connection.db, service);

try {
  let results;
  if (command === "publish-one") {
    const postId = process.argv[3] ?? "";
    if (!process.argv.includes("--confirm")) {
      throw new Error(
        "publish-one publishes to the live Page; add --confirm to proceed.",
      );
    }
    const summary = await service.publishDue(1, { onlyPostId: postId });
    results = [
      {
        job: "publish-one",
        status: summary.published ? "ok" : "failed",
        summary,
      },
    ];
  } else if (command === "default")
    results = [await jobs.run("render"), ...(await jobs.tick())];
  else if (command === "daily") results = await jobs.daily();
  else if ((socialJobNames as readonly string[]).includes(command))
    results = [await jobs.run(command as SocialJobName)];
  else throw new Error(`Unknown command: ${command}`);
  for (const result of results) {
    console.log(JSON.stringify(result));
  }
  process.exitCode = results.some((result) => result.status === "failed")
    ? 1
    : 0;
} finally {
  await connection.client.end({ timeout: 5 });
}
