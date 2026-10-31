import sharp from "sharp";
import { describe, expect, it } from "vitest";

import {
  buildStoryboard,
  reelConcepts,
  type ReelLength,
} from "@/features/social/domain/reels";
import type {
  SocialProduct,
  StoreFacts,
} from "@/features/social/domain/social-catalog";

import { isFfmpegAvailable } from "./reel-templates";
import {
  renderStoryboard,
  STORY_HEIGHT,
  STORY_WIDTH,
} from "./storyboard-video";

const store: StoreFacts = {
  name: "MAYTHA MARKET",
  whatsAppE164: "+972599105456",
  deliveryAreaAr: "ميثلون",
  deliveryFeeAgorot: 500,
  freeDeliveryFromAgorot: 10_000,
  cashOnDelivery: true,
};
const product: SocialProduct = {
  id: "softener",
  slug: "softener",
  name: "منعّم ومعطّر الملابس لويال",
  brand: null,
  categoryCode: "laundry",
  categoryName: "الغسيل",
  priceAgorot: 1000,
  priceVaries: false,
  imageUrl: "https://cdn.test/softener.webp",
  description: null,
  usageNotes: null,
  variants: [],
};

// Pango needs the Linux libvips, and the Reel needs FFmpeg: both exist on the worker, not here.
describe.skipIf(process.platform === "win32")("Reels rendering", () => {
  for (const concept of reelConcepts) {
    for (const seconds of [6, 15] as ReelLength[]) {
      it(`${concept} (${seconds} s) is a real vertical video of that length`, async () => {
        if (!(await isFfmpegAvailable())) return;
        const board = buildStoryboard({
          concept,
          seconds,
          products: [product],
          store,
          origin: "https://www.maytha.app",
        });
        const photo = await sharp({
          create: {
            width: 400,
            height: 400,
            channels: 3,
            background: "#e04090",
          },
        })
          .png()
          .toBuffer();
        const rendered = await renderStoryboard({
          board,
          photos: new Map([["softener", photo]]),
          store,
          siteLabel: "www.maytha.app",
        });
        expect(rendered.seconds).toBeCloseTo(seconds, 5);
        expect(rendered.mp4.subarray(4, 8).toString("latin1")).toBe("ftyp");
        expect(rendered.mp4.byteLength).toBeGreaterThan(20_000);
        expect(rendered.frames).toHaveLength(board.scenes.length);
        for (const frame of rendered.frames) {
          const meta = await sharp(frame).metadata();
          expect([meta.width, meta.height]).toEqual([
            STORY_WIDTH,
            STORY_HEIGHT,
          ]);
        }
      }, 120_000);
    }
  }
});
