import sharp from "sharp";
import { describe, expect, it } from "vitest";

import {
  shortProductName,
  type Bundle,
} from "@/features/social/domain/bundles";
import {
  campaignAngles,
  type CampaignAngle,
} from "@/features/social/domain/campaigns";
import type { StoreFacts } from "@/features/social/domain/social-catalog";

import {
  campaignStoryExport,
  overlaps,
  renderCampaignImage,
} from "./campaign-templates";

const store: StoreFacts = {
  name: "MAYTHA MARKET",
  whatsAppE164: "+972599105456",
  deliveryAreaAr: "ميثلون",
  deliveryFeeAgorot: 500,
  freeDeliveryFromAgorot: 5000,
  cashOnDelivery: true,
};

function bundleOf(count: number): Bundle {
  const items = Array.from({ length: count }, (_, i) => ({
    productId: `p${i}`,
    variantId: `p${i}-v`,
    variantLabel: null,
    name: `منتج تنظيف رقم ${i + 1} – عبوة كبيرة 1 لتر`,
    imageUrl: `https://cdn.test/p${i}.webp`,
    priceAgorot: 1200 + i * 100,
  }));
  const totalAgorot = items.reduce((sum, item) => sum + item.priceAgorot, 0);
  return {
    themeId: "kitchen",
    nameAr: "باكيج المطبخ",
    forAr: "مطبخ نظيف وجلي بلا تعب",
    items,
    totalAgorot,
    freeDelivery: totalAgorot >= 5000,
    missingAgorot: Math.max(0, 5000 - totalAgorot),
  };
}

async function photos(count: number) {
  const photo = await sharp({
    create: { width: 400, height: 400, channels: 3, background: "#3366cc" },
  })
    .png()
    .toBuffer();
  return new Map(Array.from({ length: count }, (_, i) => [`p${i}`, photo]));
}

async function render(angle: CampaignAngle, count: number) {
  const bundle =
    angle.needs === "nothing" ||
    angle.needs === "tip" ||
    angle.needs === "product"
      ? null
      : bundleOf(count);
  // A long real-style name, so wrapping and the price row are exercised.
  const product = {
    id: "p0",
    slug: "p0",
    name: "منظف ومعطر البلاط ليلاك 4 في 1 – 1 لتر روايح متعددة",
    brand: null,
    categoryCode: "home-cleaners",
    categoryName: "منظفات المنزل",
    priceAgorot: 1000,
    priceVaries: true,
    imageUrl: "https://cdn.test/p0.webp",
    description: null,
    usageNotes: null,
    variants: [],
  };
  return renderCampaignImage({
    type: angle.type,
    layout: angle.layout,
    pose: angle.pose,
    copy: angle.copy({
      store,
      origin: "https://m.test",
      bundle,
      products: angle.needs === "product" ? [product] : [],
      tipId: "combine-order",
    }),
    bundle,
    tipId: "combine-order",
    photos: await photos(Math.max(count, 1)),
    product:
      angle.needs === "product"
        ? {
            id: "p0",
            name: product.name,
            priceLabel: "ابتداءً من 10 ₪",
            categoryName: product.categoryName,
          }
        : null,
    store,
    siteLabel: "www.maytha.app",
  });
}

describe("shortProductName", () => {
  it("keeps the core of a product name for a small card", () => {
    expect(shortProductName("سائل جلي فيري - بعدة روائح")).toBe(
      "سائل جلي فيري",
    );
    expect(shortProductName("شامبو البركان (750 مل)")).toBe("شامبو البركان");
    expect(shortProductName("أ".repeat(40))).toHaveLength(28);
  });
});

// Arabic text goes through Pango, which needs the Linux build of libvips (Vercel's platform).
describe.skipIf(process.platform === "win32")("campaign images", () => {
  for (const angle of campaignAngles) {
    for (const count of angle.needs === "nothing" ||
    angle.needs === "tip" ||
    angle.needs === "product"
      ? [0]
      : [3, 4, 5]) {
      it(`${angle.id} (${count} products): 1080×1350, and the mascot never covers products, prices, logo or footer`, async () => {
        const result = await render(angle, count);
        const meta = await sharp(result.image).metadata();
        expect([meta.width, meta.height, meta.format]).toEqual([
          1080,
          1350,
          "jpeg",
        ]);
        // Meetho is in every campaign.
        expect(result.mascotBox).not.toBeNull();
        for (const box of result.protectedBoxes) {
          expect(overlaps(result.mascotBox!, box), JSON.stringify(box)).toBe(
            false,
          );
        }
        // Every protected area stays on the canvas.
        for (const box of result.protectedBoxes) {
          expect(box.left).toBeGreaterThanOrEqual(0);
          expect(box.left + box.width).toBeLessThanOrEqual(1080);
          expect(box.top + box.height).toBeLessThanOrEqual(1350);
        }
      }, 30_000);
    }
  }
  it("exports a campaign as a 9:16 Story without cropping it", async () => {
    const result = await render(campaignAngles[0]!, 3);
    const story = await campaignStoryExport(result.image);
    const meta = await sharp(story).metadata();
    expect([meta.width, meta.height, meta.format]).toEqual([
      1080,
      1920,
      "jpeg",
    ]);
  }, 30_000);

  it("falls back to the approved presenting pose when the planned pose is not usable", async () => {
    const angle = campaignAngles.find((a) => a.layout === "mascot_hero")!;
    const result = await render({ ...angle, pose: "shopping" }, 0);
    expect(result.mascotBox).not.toBeNull();
  }, 30_000);
});
