import { describe, expect, it } from "vitest";

import { checkCaption } from "./caption-guard";
import { angleCreative } from "./campaign-creative";
import {
  campaignAngles,
  campaignCopy,
  campaignDestination,
  campaignForType,
  campaignHooks,
  campaignObjectives,
  planCampaigns,
  plannableTypes,
  bundlePrices,
  adCopy,
  AD_DESCRIPTION_MAX,
  AD_HEADLINE_MAX,
  AD_PRIMARY_TEXT_MAX,
} from "./campaigns";
import { mascotLibrary, maxPoseHeight, poseIsUsable } from "./mascot";
import {
  buildStoryboard,
  reelConcepts,
  reelLengths,
  storyboardSeconds,
} from "./reels";
import {
  allowedPrices,
  catalogText,
  type SocialProduct,
  type StoreFacts,
} from "./social-catalog";

const store: StoreFacts = {
  name: "MAYTHA MARKET",
  whatsAppE164: "+972599105456",
  deliveryAreaAr: "ميثلون",
  deliveryFeeAgorot: 500,
  freeDeliveryFromAgorot: 10_000,
  cashOnDelivery: true,
};
const origin = "https://www.maytha.app";

function product(
  id: string,
  categoryCode: string,
  name: string,
  price: number,
): SocialProduct {
  return {
    id,
    slug: id,
    name,
    brand: null,
    categoryCode,
    categoryName: categoryCode,
    priceAgorot: price,
    priceVaries: false,
    imageUrl: `https://cdn.test/${id}.webp`,
    description: null,
    usageNotes: null,
    variants: [
      { id: `${id}-v`, label: "الافتراضي", priceAgorot: price, imageUrl: null },
    ],
  };
}

const products: SocialProduct[] = [
  product("dish", "kitchen-dishwashing", "سائل جلي فيري", 1000),
  product("sponge", "kitchen-dishwashing", "إسفنج جلي وتنظيف الصحون", 500),
  product(
    "degrease",
    "kitchen-dishwashing",
    "فينيسيا مزيل الزيوت والدهون",
    800,
  ),
  product("tabs", "kitchen-dishwashing", "أقراص غسالة الصحون فينيش", 3200),
  product("powder", "laundry", "مسحوق غسيل البركان المركز", 600),
  product("softener", "laundry", "منعّم ومعطّر الملابس لويال", 1000),
  product("gel", "laundry", "أريال باور جل لغسيل الملابس", 2700),
  product("ariel", "laundry", "مسحوق غسيل أريال", 5400),
  product("stain", "home-cleaners", "مزيل البقع متعدد الاستخدامات", 1000),
  product("tiles", "home-cleaners", "منظف ومعطر البلاط ليلاك", 1000),
  product("squeegee", "cleaning-tools", "مسّاحة أرضيات مطاطية عريضة", 700),
  product("broom", "cleaning-tools", "مكنسة أرضيات 35 سم", 600),
  product("cloth", "cleaning-tools", "طقم فوط تنظيف مايكروفايبر", 1000),
  product("air", "home-fragrances", "معطر الجو لويال", 1000),
  product("carpet", "carpet-upholstery", "بودرة معطر السجاد والغرف", 1500),
  product("odor", "home-fragrances", "مزيل الروائح القوية البركان", 1500),
];

describe("ميثو's pose library", () => {
  it("draws only approved artwork and never enlarges a small crop", () => {
    expect(poseIsUsable("presenting")).toBe(true);
    expect(poseIsUsable("shopping")).toBe(false);
    expect(poseIsUsable("laundry")).toBe(false);
    expect(poseIsUsable(null)).toBe(false);
    // Approved art is never enlarged past its source either.
    expect(maxPoseHeight("presenting", 500)).toBe(500);
    expect(maxPoseHeight("presenting", 700)).toBe(635);
    expect(maxPoseHeight("wave", 700)).toBe(Math.floor(154 * 1.6));
  });

  it("every campaign angle asks for a pose that can be drawn", () => {
    for (const angle of campaignAngles) {
      expect(angle.pose, angle.id).not.toBeNull();
      expect(poseIsUsable(angle.pose), angle.id).toBe(true);
    }
    expect(mascotLibrary.shopping.status).toBe("blocked");
  });
});

describe("campaign brief and hooks", () => {
  const plan = planCampaigns({
    startDate: "2026-11-01",
    days: 28,
    products,
    store,
  });

  it("every angle has a name, a customer problem and two more hooks", () => {
    for (const angle of campaignAngles) {
      expect(angleCreative[angle.id], angle.id).toBeDefined();
      expect(angleCreative[angle.id]!.nameAr).toBeTruthy();
      expect(angleCreative[angle.id]!.problemAr).toBeTruthy();
    }
  });

  it("all three hooks pass the caption guard on the image and in the caption", () => {
    for (const campaign of plan) {
      const used = products.filter((p) => campaign.productIds.includes(p.id));
      const allowed = new Set([
        ...allowedPrices(used, store),
        ...bundlePrices(campaign.bundle),
      ]);
      const hooks = campaignHooks(campaign, { store, origin }, used);
      expect(new Set(hooks).size, campaign.angleId).toBe(3);
      for (const [index, hook] of hooks.entries()) {
        expect(
          checkCaption(hook, allowed, catalogText(used)).issues,
          hook,
        ).toEqual([]);
        const copy = campaignCopy(
          { ...campaign, hookIndex: index },
          { store, origin },
          used,
        );
        expect(copy.headline).toBe(hook);
        // An alternative hook also becomes the caption's first line.
        if (index > 0) expect(copy.caption.split("\n")[0]).toContain(hook);
        expect(
          checkCaption(copy.caption, allowed, catalogText(used)).issues,
        ).toEqual([]);
      }
    }
  });
});

describe("quick create by objective", () => {
  const slot = {
    date: "2026-11-03",
    time: "19:30",
    scheduledFor: new Date("2026-11-03T16:30:00Z"),
  };

  it("every objective can be served from a real catalog", () => {
    for (const objective of campaignObjectives) {
      const campaign = objective.types
        .map((type) => campaignForType(type, slot, { products, store }))
        .find(Boolean);
      expect(campaign, objective.id).toBeTruthy();
      expect(objective.types).toContain(campaign!.type);
      expect(plannableTypes).toContain(campaign!.type);
    }
  });

  it("tags the destination for attribution and sends product campaigns to the product page", () => {
    const discovery = campaignForType("product_discovery", slot, {
      products,
      store,
    })!;
    const url = new URL(
      campaignDestination(
        discovery,
        origin,
        products.filter((p) => discovery.productIds.includes(p.id)),
      ),
    );
    expect(url.origin).toBe(origin);
    expect(url.pathname).toMatch(/^\/products\//);
    expect(url.searchParams.get("utm_source")).toBe("facebook");
    expect(url.searchParams.get("utm_campaign")).toBe(
      "product-discovery-2026-11-03",
    );
  });
});

describe("claims that need evidence", () => {
  it("flags authenticity, distribution, certification and germ claims", () => {
    for (const text of [
      "كل منتجاتنا أصلية",
      "منتج أصلي ١٠٠",
      "نحن الوكيل الرسمي",
      "موزع معتمد للشركة",
      "يقتل الجراثيم",
      "حاصل على شهادة",
      "100% original products",
    ]) {
      expect(checkCaption(text, new Set()).issues, text).toContain(
        "needs_evidence",
      );
    }
  });

  it("does not flag the owner's own product names or plain store facts", () => {
    const name = "صابونة دوف الأصلية بكريم الترطيب";
    expect(checkCaption(`جربوا ${name}`, new Set(), [name]).issues).toEqual([]);
    expect(
      checkCaption("منظفات وأغراض البيت بتوصلكم للباب", new Set()).issues,
    ).toEqual([]);
  });
});

describe("Reels storyboards", () => {
  it("leaves out the middle scenes the owner chose, keeping the length, the hook and the call to action", () => {
    const full = buildStoryboard({
      concept: "problem-to-product",
      seconds: 20,
      products: [products[5]!],
      store,
      origin,
    });
    expect(full.scenes.length).toBeGreaterThan(3);
    const shorter = buildStoryboard({
      concept: "problem-to-product",
      seconds: 20,
      products: [products[5]!],
      store,
      origin,
      // The hook and the call to action cannot be dropped.
      dropScenes: [0, 1, full.scenes.length - 1],
    });
    expect(shorter.scenes).toHaveLength(full.scenes.length - 1);
    expect(shorter.scenes[0]).toEqual({
      ...full.scenes[0]!,
      seconds: shorter.scenes[0]!.seconds,
    });
    expect(shorter.scenes.at(-1)!.layers).toEqual(full.scenes.at(-1)!.layers);
    expect(storyboardSeconds(shorter)).toBeCloseTo(20);
    // At least one middle scene always stays.
    const all = buildStoryboard({
      concept: "problem-to-product",
      seconds: 20,
      products: [products[5]!],
      store,
      origin,
      dropScenes: full.scenes.map((_, index) => index),
    });
    expect(all.scenes).toHaveLength(full.scenes.length);
  });

  it("fits every concept and length exactly, with a hook first and a call to action last", () => {
    for (const concept of reelConcepts) {
      for (const seconds of reelLengths) {
        const board = buildStoryboard({
          concept,
          seconds,
          products: [products[5]!],
          store,
          origin,
        });
        expect(storyboardSeconds(board), `${concept} ${seconds}`).toBeCloseTo(
          seconds,
          5,
        );
        expect(["hook", "problem"]).toContain(board.scenes[0]!.role);
        expect(board.scenes.at(-1)!.role).toBe("cta");
        for (const text of board.captions) {
          expect(
            checkCaption(text, allowedPrices([products[5]!], store)).issues,
            text,
          ).toEqual([]);
        }
      }
    }
  });

  it("uses only real products, their store price and the official address", () => {
    const board = buildStoryboard({
      concept: "problem-to-product",
      seconds: 15,
      products: [products[5]!],
      store,
      origin,
    });
    expect(board.productIds).toEqual(["softener"]);
    expect(board.destination).toBe(`${origin}/products/softener`);
    expect(board.captions).toContain("10 ₪");
    expect(board.captions.join(" ")).toContain("www.maytha.app");
    expect(() =>
      buildStoryboard({
        concept: "problem-to-product",
        seconds: 10,
        products: [],
        store,
        origin,
      }),
    ).toThrow("REEL_NEEDS_PRODUCT");
  });
});

describe("ad-ready copy", () => {
  it("reuses the approved words within Meta's lengths, never cutting a word", () => {
    const ad = adCopy(
      {
        headline: "كل أغراض التنظيف بطلب واحد لحد باب البيت في ميثلون",
        subline: "اختاروا من الموقع ومنوصّل",
        cta: "اطلبوا الآن",
        caption:
          "سلة البيت كاملة من مايثا ماركت 🧺\nكل اللي بتحتاجوه للجلي والغسيل والأرضيات بمكان واحد، والتوصيل لحد الباب داخل ميثلون والدفع عند الاستلام.\nhttps://www.maytha.app/?utm_campaign=mc-0123456789ab\n#مايثا_ماركت",
      },
      "https://www.maytha.app/?utm_campaign=mc-0123456789ab",
    );
    expect(ad.primaryText.length).toBeLessThanOrEqual(AD_PRIMARY_TEXT_MAX);
    expect(ad.headline.length).toBeLessThanOrEqual(AD_HEADLINE_MAX);
    expect(ad.description.length).toBeLessThanOrEqual(AD_DESCRIPTION_MAX);
    expect(ad.primaryText).not.toContain("http");
    expect(ad.primaryText).not.toContain("#");
    expect(ad.headline.endsWith("…")).toBe(true);
    // Every word kept is a whole word of the original.
    for (const word of ad.headline.replace("…", "").split(" ")) {
      expect("كل أغراض التنظيف بطلب واحد لحد باب البيت في ميثلون").toContain(
        word,
      );
    }
    expect(ad.link).toContain("mc-0123456789ab");
  });
});
