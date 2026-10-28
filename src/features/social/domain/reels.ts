import { formatIls } from "@/shared/lib/format-currency";

import { coreProductName, shortProductName } from "./bundles";
import type { MascotPose } from "./mascot";
import {
  formatSocialPrice,
  productUrl,
  type SocialProduct,
  type StoreFacts,
} from "./social-catalog";

/**
 * Reels Studio: a Reel is a storyboard of scenes, each a set of layers (ميثو, a product card,
 * Arabic text, a price, the call to action) that enter with their own motion. The storyboard is
 * plain data: the owner can read and edit it, and the renderer turns it into a vertical video.
 * No voice: voiceover needs a licensed voice and is not part of this version.
 */
export const reelConcepts = [
  "meet-meetho",
  "problem-to-product",
  "delivery-explainer",
] as const;
export type ReelConcept = (typeof reelConcepts)[number];

export const reelConceptLabels: Record<ReelConcept, string> = {
  "meet-meetho": "ميثو يعرّف بمايثا",
  "problem-to-product": "مشكلة بالبيت ومنتج حقيقي",
  "delivery-explainer": "كيف بيوصلكم الطلب",
};

export const reelLengths = [6, 10, 15, 20, 30] as const;
export type ReelLength = (typeof reelLengths)[number];

export type LayerMotion = "slide-left" | "slide-right" | "rise" | "fade";

export type StoryLayer =
  | { kind: "mascot"; pose: MascotPose; enter: LayerMotion; at: number }
  | { kind: "product"; productId: string; enter: LayerMotion; at: number }
  | {
      kind: "text";
      text: string;
      size: "hook" | "title" | "body";
      enter: LayerMotion;
      at: number;
    }
  | { kind: "price"; text: string; enter: LayerMotion; at: number }
  | { kind: "cta"; text: string; enter: LayerMotion; at: number }
  | { kind: "logo"; enter: LayerMotion; at: number };

export interface StoryScene {
  /** What the scene does in the story, for the owner reading the storyboard. */
  role: "hook" | "problem" | "product" | "detail" | "cta";
  seconds: number;
  background: "cream" | "green";
  layers: StoryLayer[];
}

export interface Storyboard {
  concept: ReelConcept;
  titleAr: string;
  seconds: ReelLength;
  scenes: StoryScene[];
  /** On-screen text in order, also usable as the post's subtitles. */
  captions: string[];
  productIds: string[];
  destination: string;
}

/** The scene lengths for a total: hook and call to action get room, the middle shares the rest. */
export function sceneSeconds(
  total: ReelLength,
  middleScenes: number,
): number[] {
  if (total <= 6) return [3, 3];
  const ends = total <= 10 ? 2.5 : 3.5;
  const middle = (total - ends * 2) / middleScenes;
  return [ends, ...Array.from({ length: middleScenes }, () => middle), ends];
}

/** The household problem a product's category answers, in the store's own terms. */
function problemFor(product: SocialProduct): string {
  switch (product.categoryCode) {
    case "laundry":
      return "الغسيل متراكم؟";
    case "kitchen-dishwashing":
      return "الجلي متراكم بالمطبخ؟";
    case "bathroom":
      return "الحمّام بدّه تنظيف؟";
    case "home-fragrances":
      return "بدّكم البيت ريحته حلوة؟";
    case "cleaning-tools":
      return "بدّكم أدوات تسهّل التنظيف؟";
    default:
      return "البيت بدّه ترتيب؟";
  }
}

export interface StoryboardInput {
  concept: ReelConcept;
  seconds: ReelLength;
  products: readonly SocialProduct[];
  store: StoreFacts;
  origin: string;
}

const site = (origin: string) => origin.replace(/^https?:\/\//, "");

export function buildStoryboard(input: StoryboardInput): Storyboard {
  const { store, origin } = input;
  const freeFrom = formatIls(store.freeDeliveryFromAgorot);
  const fee = formatIls(store.deliveryFeeAgorot);
  const cta = (at = 0.2): StoryScene["layers"] => [
    { kind: "logo", enter: "fade", at },
    {
      kind: "cta",
      text: `اطلبوا من ${site(origin)}`,
      enter: "rise",
      at: at + 0.4,
    },
  ];
  let scenes: StoryScene[];
  let productIds: string[] = [];
  let destination = origin;
  let titleAr = reelConceptLabels[input.concept];

  if (input.concept === "meet-meetho") {
    const [hook, ...rest] = sceneSeconds(input.seconds, 2);
    scenes = [
      {
        role: "hook",
        seconds: hook!,
        background: "cream",
        layers: [
          {
            kind: "text",
            text: "مرحبا! أنا ميثو",
            size: "hook",
            enter: "fade",
            at: 0.1,
          },
          { kind: "mascot", pose: "presenting", enter: "slide-left", at: 0.3 },
        ],
      },
      {
        role: "detail",
        seconds: rest[0]!,
        background: "cream",
        layers: [
          {
            kind: "text",
            text: `من مايثا ماركت في ${store.deliveryAreaAr}`,
            size: "title",
            enter: "fade",
            at: 0.1,
          },
          {
            kind: "text",
            text: "منظفات وأغراض البيت بتوصلكم للباب",
            size: "body",
            enter: "rise",
            at: 0.6,
          },
        ],
      },
      {
        role: "detail",
        seconds: rest[1]!,
        background: "cream",
        layers: [
          {
            kind: "text",
            text: `توصيل داخل ${store.deliveryAreaAr}`,
            size: "body",
            enter: "slide-right",
            at: 0.1,
          },
          ...(store.cashOnDelivery
            ? [
                {
                  kind: "text" as const,
                  text: "الدفع عند الاستلام",
                  size: "body" as const,
                  enter: "slide-right" as const,
                  at: 0.5,
                },
              ]
            : []),
          {
            kind: "price",
            text: `التوصيل مجاني من ${freeFrom}`,
            enter: "rise",
            at: 0.9,
          },
        ],
      },
      { role: "cta", seconds: rest[2]!, background: "green", layers: cta() },
    ];
  } else if (input.concept === "problem-to-product") {
    const product = input.products[0];
    if (!product) throw new Error("REEL_NEEDS_PRODUCT");
    productIds = [product.id];
    destination = productUrl(origin, product);
    titleAr = `${reelConceptLabels[input.concept]}: ${shortProductName(product.name)}`;
    const [hook, ...rest] = sceneSeconds(input.seconds, 2);
    scenes = [
      {
        role: "problem",
        seconds: hook!,
        background: "cream",
        layers: [
          {
            kind: "text",
            text: problemFor(product),
            size: "hook",
            enter: "fade",
            at: 0.1,
          },
          { kind: "mascot", pose: "presenting", enter: "slide-right", at: 0.4 },
        ],
      },
      {
        role: "product",
        seconds: rest[0]!,
        background: "cream",
        layers: [
          {
            kind: "text",
            text: "ميثو عنده إلكم فكرة",
            size: "title",
            enter: "fade",
            at: 0.1,
          },
          { kind: "product", productId: product.id, enter: "rise", at: 0.4 },
        ],
      },
      {
        role: "detail",
        seconds: rest[1]!,
        background: "cream",
        layers: [
          { kind: "product", productId: product.id, enter: "fade", at: 0 },
          {
            kind: "text",
            text: coreProductName(product.name),
            size: "body",
            enter: "rise",
            at: 0.2,
          },
          {
            kind: "price",
            text: formatSocialPrice(product),
            enter: "slide-left",
            at: 0.6,
          },
        ],
      },
      { role: "cta", seconds: rest[2]!, background: "green", layers: cta() },
    ];
  } else {
    const [hook, ...rest] = sceneSeconds(input.seconds, 2);
    scenes = [
      {
        role: "hook",
        seconds: hook!,
        background: "cream",
        layers: [
          {
            kind: "text",
            text: "طلبكم لحد باب البيت",
            size: "hook",
            enter: "fade",
            at: 0.1,
          },
          { kind: "mascot", pose: "delivery", enter: "slide-left", at: 0.4 },
        ],
      },
      {
        role: "detail",
        seconds: rest[0]!,
        background: "cream",
        layers: [
          {
            kind: "text",
            text: "١. اختاروا من الموقع",
            size: "body",
            enter: "slide-right",
            at: 0.1,
          },
          {
            kind: "text",
            text: "٢. أكّدوا الطلب بعنوانكم",
            size: "body",
            enter: "slide-right",
            at: 0.6,
          },
          {
            kind: "text",
            text: `٣. منوصّل داخل ${store.deliveryAreaAr}`,
            size: "body",
            enter: "slide-right",
            at: 1.1,
          },
        ],
      },
      {
        role: "detail",
        seconds: rest[1]!,
        background: "cream",
        layers: [
          {
            kind: "price",
            text: `مجاني من ${freeFrom}`,
            enter: "rise",
            at: 0.1,
          },
          {
            kind: "text",
            text: `وتحت هيك ${fee} بس`,
            size: "body",
            enter: "fade",
            at: 0.6,
          },
        ],
      },
      { role: "cta", seconds: rest[2]!, background: "green", layers: cta() },
    ];
  }
  // A 6-second Reel keeps only the hook and the call to action.
  if (input.seconds <= 6) scenes = [scenes[0]!, scenes.at(-1)!];
  const lengths = sceneSeconds(input.seconds, Math.max(0, scenes.length - 2));
  scenes = scenes.map((scene, index) => ({
    ...scene,
    seconds: lengths[index]!,
  }));
  const captions = scenes.flatMap((scene) =>
    scene.layers.flatMap((layer) =>
      layer.kind === "text" || layer.kind === "price" || layer.kind === "cta"
        ? [layer.text]
        : [],
    ),
  );
  return {
    concept: input.concept,
    titleAr,
    seconds: input.seconds,
    scenes,
    captions,
    productIds,
    destination,
  };
}

/** Total length of a storyboard, before scene transitions overlap. */
export function storyboardSeconds(board: Pick<Storyboard, "scenes">): number {
  return board.scenes.reduce((sum, scene) => sum + scene.seconds, 0);
}
