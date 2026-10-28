import sharp from "sharp";
import { describe, expect, it } from "vitest";

import type { Bundle } from "@/features/social/domain/bundles";
import {
  campaignAngles,
  type CampaignAngle,
} from "@/features/social/domain/campaigns";
import type { StoreFacts } from "@/features/social/domain/social-catalog";

import { overlaps, renderCampaignImage, shortName } from "./campaign-templates";

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
    angle.needs === "nothing" || angle.needs === "tip" ? null : bundleOf(count);
  return renderCampaignImage({
    type: angle.type,
    layout: angle.layout,
    pose: angle.pose,
    copy: angle.copy({
      store,
      origin: "https://m.test",
      bundle,
      products: [],
      tipId: "combine-order",
    }),
    bundle,
    tipId: "combine-order",
    photos: await photos(count),
    store,
    siteLabel: "maithaloun-sooq.vercel.app",
  });
}

describe("shortName", () => {
  it("keeps the core of a product name for a small card", () => {
    expect(shortName("سائل جلي فيري - بعدة روائح")).toBe("سائل جلي فيري");
    expect(shortName("شامبو البركان (750 مل)")).toBe("شامبو البركان");
    expect(shortName("أ".repeat(40))).toHaveLength(28);
  });
});

// Arabic text goes through Pango, which needs the Linux build of libvips (Vercel's platform).
describe.skipIf(process.platform === "win32")("campaign images", () => {
  for (const angle of campaignAngles) {
    for (const count of angle.needs === "nothing" || angle.needs === "tip"
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
        if (result.mascotBox) {
          for (const box of result.protectedBoxes) {
            expect(overlaps(result.mascotBox, box), JSON.stringify(box)).toBe(
              false,
            );
          }
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
});
