/**
 * The first content batch for the owner's review: a 30-day calendar from the live catalog, seven feed
 * posts, five product showcases and three Reels, with their Arabic captions. Nothing is published.
 *
 *   pnpm social:batch [startDate] [outDir]
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
  deliveryCaption,
  newArrivalsCaption,
  postKindLabels,
  productCaption,
  collectionCaption,
  reelCaption,
  reelTemplateLabels,
  tipCaption,
  weeklyHighlightsCaption,
  type CaptionContext,
  type ReelTemplate,
} from "../src/features/social/domain/captions";
import {
  buildContentPlan,
  rotationOrder,
  type PlannedItem,
} from "../src/features/social/domain/content-plan";
import {
  allowedPrices,
  catalogText,
  formatSocialPrice,
  type SocialProduct,
} from "../src/features/social/domain/social-catalog";
import { httpCatalogSource } from "../src/features/social/infrastructure/catalog-source";
import { fetchImage } from "../src/features/social/infrastructure/render/brand";
import { renderFeedImage } from "../src/features/social/infrastructure/render/image-templates";
import { renderReel } from "../src/features/social/infrastructure/render/reel-templates";
import {
  addDays,
  STORE_TIME_ZONE,
  todayInStoreZone,
} from "../src/shared/lib/store-time";

config({ path: ".env.local", quiet: true });

const origin = socialOrigin({
  ...process.env,
  SOCIAL_PUBLIC_ORIGIN:
    process.env.SOCIAL_PUBLIC_ORIGIN || "https://maithaloun-sooq.vercel.app",
});
const label = siteLabel(origin);
const startDate = process.argv[2] ?? addDays(todayInStoreZone(), 1);
const outDir = path.resolve(
  process.argv[3] ??
    path.join("artifacts", "social", `first-batch-${startDate}`),
);

const catalog = await httpCatalogSource(
  process.env.SOCIAL_CATALOG_ORIGIN || origin,
)();
const context: CaptionContext = { store: catalog.store, origin };
const byId = new Map(catalog.products.map((product) => [product.id, product]));
const plan = buildContentPlan({
  startDate,
  days: 30,
  products: catalog.products,
});
const photoCache = new Map<string, Buffer>();

async function photosFor(products: readonly SocialProduct[]) {
  const photos = new Map<string, Buffer>();
  for (const product of products) {
    const bytes =
      photoCache.get(product.imageUrl) ?? (await fetchImage(product.imageUrl));
    photoCache.set(product.imageUrl, bytes);
    photos.set(product.id, bytes);
  }
  return photos;
}

function productsOf(item: Pick<PlannedItem, "productIds">): SocialProduct[] {
  return item.productIds.map((id) => byId.get(id)!).filter(Boolean);
}

function captionOf(item: PlannedItem, products: SocialProduct[]): string {
  if (item.format === "reel" && item.reelTemplate)
    return reelCaption(item.reelTemplate, products, context);
  switch (item.kind) {
    case "product":
      return productCaption(products[0]!, context);
    case "collection":
      return collectionCaption(
        `🧺 من قسم ${products[0]?.categoryName ?? ""} في مايثا ماركت`,
        "متوفر هلأ:",
        products,
        context,
      );
    case "new_arrivals":
      return newArrivalsCaption(products, context);
    case "weekly_highlights":
      return weeklyHighlightsCaption(products, context);
    case "shopping_tip":
      return tipCaption(item.tipId ?? "combine-order", context);
    case "delivery_info":
      return deliveryCaption(context);
  }
}

const timeFormat = new Intl.DateTimeFormat("ar-PS-u-nu-latn", {
  timeZone: STORE_TIME_ZONE,
  weekday: "long",
  day: "numeric",
  month: "long",
  hour: "2-digit",
  minute: "2-digit",
});

await mkdir(path.join(outDir, "posts"), { recursive: true });
await mkdir(path.join(outDir, "products"), { recursive: true });
await mkdir(path.join(outDir, "reels"), { recursive: true });

const calendar = plan.map((item, index) => {
  const products = productsOf(item);
  const caption = captionOf(item, products);
  const check = checkCaption(
    caption,
    allowedPrices(products, catalog.store),
    catalogText(products),
  );
  return {
    index: index + 1,
    date: item.date,
    time: item.time,
    when: timeFormat.format(item.scheduledFor),
    scheduledFor: item.scheduledFor.toISOString(),
    format: item.format,
    title:
      item.format === "reel" && item.reelTemplate
        ? reelTemplateLabels[item.reelTemplate]
        : postKindLabels[item.kind],
    kind: item.kind,
    reelTemplate: item.reelTemplate,
    products: products.map((product) => ({
      id: product.id,
      name: product.name,
      price: formatSocialPrice(product),
      url: `${origin}/products/${product.slug}`,
    })),
    caption,
    captionCheck: check,
  };
});
const blocked = calendar.filter((entry) => !entry.captionCheck.ok);
if (blocked.length) {
  console.error(
    "Caption guard blocked:",
    blocked.map(
      (entry) => `${entry.index}:${entry.captionCheck.issues.join(",")}`,
    ),
  );
  process.exit(1);
}

// Seven feed posts: the first seven feed slots of the calendar, exactly as they would go out.
const feedItems = plan.filter((item) => item.format === "image").slice(0, 7);
const posts = [];
for (const [index, item] of feedItems.entries()) {
  const products = productsOf(item);
  const image = await renderFeedImage({
    kind: item.kind,
    products,
    photos: await photosFor(products),
    store: catalog.store,
    siteLabel: label,
    tipId: item.tipId,
    categoryName: item.categoryCode
      ? (products[0]?.categoryName ?? null)
      : null,
  });
  const file = `posts/${String(index + 1).padStart(2, "0")}-${item.kind}.jpg`;
  await writeFile(path.join(outDir, file), image);
  posts.push({
    file,
    date: item.date,
    time: item.time,
    title: postKindLabels[item.kind],
    caption: captionOf(item, products),
    products: products.map((product) => product.name),
  });
  console.log("post", file);
}

// Five product showcases: products the calendar does not already feature in its first feed posts.
const featured = new Set(feedItems.flatMap((item) => item.productIds));
const showcase = rotationOrder(catalog.products)
  .filter((product) => !featured.has(product.id))
  .slice(0, 5);
const productImages = [];
for (const [index, product] of showcase.entries()) {
  const image = await renderFeedImage({
    kind: "product",
    products: [product],
    photos: await photosFor([product]),
    store: catalog.store,
    siteLabel: label,
  });
  const file = `products/${index + 1}-${product.slug}.jpg`;
  await writeFile(path.join(outDir, file), image);
  productImages.push({
    file,
    name: product.name,
    price: formatSocialPrice(product),
    caption: productCaption(product, context),
  });
  console.log("product", file);
}

// Three Reels: one per template, from the calendar's own Reel slots.
const reels = [];
for (const template of [
  "spotlight",
  "collection",
  "delivery",
] as ReelTemplate[]) {
  const item = plan.find((candidate) => candidate.reelTemplate === template);
  const products = item
    ? productsOf(item)
    : rotationOrder(catalog.products).slice(
        0,
        template === "spotlight" ? 1 : 3,
      );
  const reel = await renderReel({
    template,
    products,
    photos: await photosFor(products),
    store: catalog.store,
    siteLabel: label,
  });
  await writeFile(path.join(outDir, `reels/${template}.mp4`), reel.mp4);
  await writeFile(path.join(outDir, `reels/${template}.jpg`), reel.poster);
  reels.push({
    file: `reels/${template}.mp4`,
    poster: `reels/${template}.jpg`,
    title: reelTemplateLabels[template],
    seconds: reel.seconds,
    date: item?.date ?? null,
    time: item?.time ?? null,
    caption: reelCaption(template, products, context),
    products: products.map((product) => product.name),
  });
  console.log("reel", template, reel.seconds, "s");
}

const manifest = {
  generatedAt: new Date().toISOString(),
  origin,
  startDate,
  store: catalog.store,
  eligibleProducts: catalog.products.length,
  calendar,
  posts,
  productImages,
  reels,
};
await writeFile(
  path.join(outDir, "batch.json"),
  JSON.stringify(manifest, null, 2),
);
const markdown = [
  `# MAYTHA MARKET — Facebook calendar from ${startDate} (30 days)`,
  "",
  "Status: drafts for approval. Nothing has been published.",
  "",
  "| # | When (Palestine time) | Format | Content | Products |",
  "|---|---|---|---|---|",
  ...calendar.map(
    (entry) =>
      `| ${entry.index} | ${entry.when} | ${entry.format === "reel" ? "Reel" : "Post"} | ${entry.title} | ${entry.products.map((product) => `${product.name} (${product.price})`).join("<br>") || "—"} |`,
  ),
  "",
  "## Captions",
  "",
  ...calendar.flatMap((entry) => [
    `### ${entry.index}. ${entry.when} — ${entry.title}`,
    "",
    "```",
    entry.caption,
    "```",
    "",
  ]),
].join("\n");
await writeFile(path.join(outDir, "calendar.md"), markdown);
console.log(
  `Batch written to ${outDir}: ${calendar.length} calendar entries, ${posts.length} posts, ${productImages.length} product images, ${reels.length} reels`,
);
