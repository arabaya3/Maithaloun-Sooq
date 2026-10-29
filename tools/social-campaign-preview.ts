/**
 * Plans a two-week campaign calendar from the live catalog and renders every campaign for review.
 * It reads the public catalog only: no database, no AI call, nothing is published.
 *
 *   pnpm social:campaigns [startDate] [outDir]
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { config } from "dotenv";

import {
  siteLabel,
  socialOrigin,
} from "../src/features/social/application/social-factory";
import { checkCaption } from "../src/features/social/domain/caption-guard";
import {
  campaignCopy,
  campaignPrices,
  campaignTypeLabels,
  planCampaigns,
} from "../src/features/social/domain/campaigns";
import {
  allowedPrices,
  catalogText,
  formatSocialPrice,
} from "../src/features/social/domain/social-catalog";
import { httpCatalogSource } from "../src/features/social/infrastructure/catalog-source";
import { fetchImage } from "../src/features/social/infrastructure/render/brand";
import {
  campaignStoryExport,
  renderCampaignImage,
} from "../src/features/social/infrastructure/render/campaign-templates";
import { addDays, todayInStoreZone } from "../src/shared/lib/store-time";

config({ path: ".env.local", quiet: true });

const origin = socialOrigin({
  SOCIAL_PUBLIC_ORIGIN:
    process.env.SOCIAL_PUBLIC_ORIGIN || "https://www.maytha.app",
});
const startDate = process.argv[2] ?? addDays(todayInStoreZone(), 1);
const outDir = path.resolve(
  process.argv[3] ?? path.join("artifacts", "social", `campaigns-${startDate}`),
);

const catalog = await httpCatalogSource(
  process.env.SOCIAL_CATALOG_ORIGIN || origin,
)();
const byId = new Map(catalog.products.map((product) => [product.id, product]));
const plan = planCampaigns({
  startDate,
  days: 14,
  products: catalog.products,
  store: catalog.store,
});
await mkdir(outDir, { recursive: true });

const photos = new Map<string, Buffer>();
const report: string[] = [`# Campaign calendar from ${startDate}`, ""];
let failures = 0;
for (const [index, campaign] of plan.entries()) {
  const products = campaign.productIds.map((id) => byId.get(id)!);
  for (const product of products) {
    const item = campaign.bundle?.items.find((i) => i.productId === product.id);
    if (!photos.has(product.id)) {
      photos.set(
        product.id,
        await fetchImage(item?.imageUrl ?? product.imageUrl),
      );
    }
  }
  const copy = campaignCopy(
    campaign,
    { store: catalog.store, origin },
    products,
  );
  const check = checkCaption(
    copy.caption,
    new Set([
      ...allowedPrices(products, catalog.store),
      ...campaignPrices(campaign),
    ]),
    catalogText(products),
  );
  if (!check.ok) failures += 1;
  const render = await renderCampaignImage({
    type: campaign.type,
    layout: campaign.layout,
    pose: campaign.pose,
    copy,
    bundle: campaign.bundle,
    tipId: campaign.tipId,
    photos,
    product:
      campaign.layout === "product_spotlight" && products[0]
        ? {
            id: products[0].id,
            name: products[0].name,
            priceLabel: formatSocialPrice(products[0]),
            categoryName: products[0].categoryName || null,
          }
        : null,
    store: catalog.store,
    siteLabel: siteLabel(origin),
  });
  const file = `${String(index + 1).padStart(2, "0")}-${campaign.angleId}.jpg`;
  await writeFile(path.join(outDir, file), render.image);
  // The same approved design as a 9:16 Story.
  await writeFile(
    path.join(outDir, file.replace(/.jpg$/, "-story.jpg")),
    await campaignStoryExport(render.image),
  );
  report.push(
    `## ${index + 1}. ${campaign.date} ${campaign.time} · ${campaignTypeLabels[campaign.type]} · ${campaign.angleId}`,
    "",
    `- Objective: ${campaign.objective}`,
    `- Audience: ${campaign.audience}`,
    `- Concept: ${campaign.concept}`,
    `- Layout: ${campaign.layout}${campaign.pose ? ` · ميثو: ${campaign.pose}` : ""}`,
    `- Caption check: ${check.ok ? "passes" : `BLOCKED (${check.issues.join(", ")})`}`,
    `- Image: ${file}`,
    "",
    "```",
    copy.caption,
    "```",
    "",
  );
}
await writeFile(path.join(outDir, "calendar.md"), report.join("\n"));
console.log(
  `${plan.length} campaigns in ${outDir}; caption check failures: ${failures}`,
);
process.exitCode = failures ? 1 : 0;
