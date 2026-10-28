import { describe, expect, it } from "vitest";

import { formatIls } from "@/shared/lib/format-currency";

import {
  availableBundles,
  bundleIsCurrent,
  bundleThemes,
  buildBundle,
  refreshBundle,
} from "./bundles";
import { checkCaption } from "./caption-guard";
import {
  campaignAngles,
  campaignCopy,
  campaignPrices,
  itemCount,
  planCampaigns,
  plannableTypes,
  replanCampaign,
} from "./campaigns";
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
  freeDeliveryFromAgorot: 5000,
  cashOnDelivery: true,
};

function product(
  id: string,
  categoryCode: string,
  name: string,
  prices: number[],
): SocialProduct {
  return {
    id,
    slug: id,
    name,
    brand: null,
    categoryCode,
    categoryName: categoryCode,
    priceAgorot: Math.min(...prices),
    priceVaries: new Set(prices).size > 1,
    imageUrl: `https://cdn.test/${id}.webp`,
    description: null,
    usageNotes: null,
    variants: prices.map((price, index) => ({
      id: `${id}-v${index}`,
      label: `حجم ${index + 1}`,
      priceAgorot: price,
      imageUrl: null,
    })),
  };
}

// Names follow the live catalog's wording, so the theme matchers are exercised for real.
const products: SocialProduct[] = [
  product("dish", "kitchen-dishwashing", "سائل جلي فيري - بعدة روائح", [1000]),
  product(
    "dish2",
    "kitchen-dishwashing",
    "سائل جلي عرار 2X بقوة مضاعفة",
    [1200],
  ),
  product("sponge", "kitchen-dishwashing", "إسفنج جلي وتنظيف الصحون", [500]),
  product(
    "degrease",
    "kitchen-dishwashing",
    "فينيسيا مزيل الزيوت والدهون",
    [800],
  ),
  product("wipes", "kitchen-dishwashing", "مناديل مبللة لتنظيف المطبخ", [500]),
  product("tabs", "kitchen-dishwashing", "أقراص غسالة الصحون فينيش", [3200]),
  product("powder", "laundry", "مسحوق غسيل البركان المركز", [600]),
  product("softener", "laundry", "منعّم ومعطّر الملابس لويال", [1000, 1400]),
  product("ariel", "laundry", "مسحوق غسيل أريال", [5400]),
  product("stain", "home-cleaners", "مزيل البقع متعدد الاستخدامات", [1000]),
  product("tiles", "home-cleaners", "منظف ومعطر البلاط ليلاك", [1000]),
  product("floors", "home-cleaners", "معطر ومنظف الأرضيات مسك", [1000]),
  product("chlorine", "home-cleaners", "كلور دولفين مبيض ومعقم", [700]),
  product("wc", "home-cleaners", "منظف حمامات ومراحيض مدهش", [600]),
  product("squeegee", "cleaning-tools", "مسّاحة أرضيات مطاطية عريضة", [700]),
  product("broom", "cleaning-tools", "مكنسة أرضيات 35 سم", [600]),
  product("cloth", "cleaning-tools", "طقم فوط تنظيف مايكروفايبر", [1000]),
  product("wc-soap", "bathroom", "صابونة مرحاض بون", [500]),
  product("air", "home-fragrances", "معطر الجو لويال بعدة روائح", [1000]),
  product("odor", "home-fragrances", "مزيل الروائح القوية البركان", [1500]),
  product("carpet", "carpet-upholstery", "بودرة معطر السجاد والغرف", [1500]),
];

describe("bundle builder", () => {
  it("uses real products at their exact variant prices and sums them in agorot", () => {
    const laundry = buildBundle(
      bundleThemes.find((t) => t.id === "laundry")!,
      products,
      store,
    )!;
    // The affordable powder fills the role before the 54 ₪ one.
    expect(laundry.items.map((item) => item.productId)).toEqual([
      "powder",
      "softener",
      "stain",
    ]);
    // The softener's cheapest variant is the one priced, and it is named.
    expect(laundry.items[1]).toMatchObject({
      variantId: "softener-v0",
      priceAgorot: 1000,
      variantLabel: "حجم 1",
    });
    expect(laundry.totalAgorot).toBe(600 + 1000 + 1000);
    expect(laundry.freeDelivery).toBe(false);
    expect(laundry.missingAgorot).toBe(5000 - 2600);
  });

  it("never invents products and leaves out unavailable ones", () => {
    const ids = new Set(products.map((p) => p.id));
    for (const bundle of availableBundles(products, store)) {
      for (const item of bundle.items)
        expect(ids.has(item.productId)).toBe(true);
    }
    const withoutDish = products.filter((p) => !p.id.startsWith("dish"));
    const kitchen = buildBundle(bundleThemes[0]!, withoutDish, store);
    expect(
      kitchen?.items.some((item) => item.productId.startsWith("dish")) ?? false,
    ).toBe(false);
  });

  it("is not a bundle below three products", () => {
    const few = products.filter((p) => ["dish", "sponge"].includes(p.id));
    expect(buildBundle(bundleThemes[0]!, few, store)).toBeNull();
  });

  it("tops up to free delivery like a shopper, without one big jump", () => {
    const kitchen = buildBundle(bundleThemes[0]!, products, store, {
      reachFreeDelivery: true,
    })!;
    expect(kitchen.totalAgorot).toBeGreaterThanOrEqual(5000);
    expect(kitchen.freeDelivery).toBe(true);
    // At most 15 ₪ over the threshold, unless nothing smaller could reach it.
    expect(kitchen.totalAgorot - 5000).toBeLessThanOrEqual(1500);
  });

  it("states honestly how much is missing when a bundle stays below the threshold", () => {
    const kitchen = buildBundle(bundleThemes[0]!, products, store)!;
    expect(kitchen.totalAgorot).toBe(1000 + 500 + 800 + 500);
    expect(kitchen.missingAgorot).toBe(5000 - kitchen.totalAgorot);
    expect(kitchen.freeDelivery).toBe(false);
  });
});

describe("campaign planner", () => {
  const plan = planCampaigns({
    startDate: "2026-11-01",
    days: 14,
    products,
    store,
  });

  it("fills every image slot of two weeks", () => {
    expect(plan).toHaveLength(8);
    expect(plan.every((c) => c.format === "image")).toBe(true);
  });

  it("varies type and layout and never repeats a type back to back", () => {
    for (let i = 1; i < plan.length; i += 1) {
      expect(plan[i]!.type).not.toBe(plan[i - 1]!.type);
    }
    expect(new Set(plan.map((c) => c.type)).size).toBeGreaterThanOrEqual(6);
    expect(new Set(plan.map((c) => c.layout)).size).toBeGreaterThanOrEqual(4);
    expect(plan.map((c) => c.type)).toContain("product_discovery");
    expect(plan.every((c) => plannableTypes.includes(c.type))).toBe(true);
  });

  it("includes bundle, free-delivery and mascot-led campaigns", () => {
    const types = plan.map((c) => c.type);
    expect(types).toContain("bundle");
    expect(types).toContain("free_delivery");
    expect(plan.some((c) => c.pose !== null)).toBe(true);
  });

  it("rotates bundle themes and keeps a product out for 7 days after it is shown", () => {
    const bundles = plan.filter((c) => c.bundle);
    for (let i = 1; i < bundles.length; i += 1) {
      expect(bundles[i]!.bundle!.themeId).not.toBe(
        bundles[i - 1]!.bundle!.themeId,
      );
    }
    const shown = new Map<string, string>();
    for (const campaign of plan) {
      for (const id of campaign.productIds) {
        const before = shown.get(id);
        if (before) {
          const days =
            (Date.parse(campaign.date) - Date.parse(before)) / 86_400_000;
          expect(days).toBeGreaterThanOrEqual(7);
        }
        shown.set(id, campaign.date);
      }
    }
  });

  it("gives every campaign an objective, audience, concept and call to action", () => {
    for (const campaign of plan) {
      expect(campaign.objective).toBeTruthy();
      expect(campaign.audience).toBeTruthy();
      expect(campaign.concept).toBeTruthy();
      const copy = campaignCopy(
        campaign,
        { store, origin: "https://m.test" },
        products.filter((p) => campaign.productIds.includes(p.id)),
      );
      expect(copy.cta).toBeTruthy();
    }
  });

  it("writes captions the guard accepts: real prices only, no offers or claims", () => {
    for (const campaign of plan) {
      const used = products.filter((p) => campaign.productIds.includes(p.id));
      const copy = campaignCopy(
        campaign,
        { store, origin: "https://m.test" },
        used,
      );
      const check = checkCaption(
        copy.caption,
        new Set([...allowedPrices(used, store), ...campaignPrices(campaign)]),
        catalogText(used),
      );
      expect(check.issues, campaign.angleId).toEqual([]);
      // The image lines are held to the same rules.
      for (const line of [copy.headline, copy.subline, copy.cta]) {
        expect(
          checkCaption(
            line,
            new Set([
              ...allowedPrices(used, store),
              ...campaignPrices(campaign),
            ]),
            catalogText(used),
          ).issues,
          `${campaign.angleId}: ${line}`,
        ).toEqual([]);
      }
    }
  });

  it("prints a bundle total that is exactly the sum of its items", () => {
    for (const campaign of plan.filter((c) => c.bundle)) {
      const copy = campaignCopy(
        campaign,
        { store, origin: "https://m.test" },
        [],
      );
      const sum = campaign.bundle!.items.reduce((s, i) => s + i.priceAgorot, 0);
      expect(copy.caption).toContain(`المجموع ${formatIls(sum)}`);
    }
  });

  it("has every angle's copy free of offers when given any bundle", () => {
    const bundle = availableBundles(products, store, {
      reachFreeDelivery: true,
    })[0]!;
    for (const angle of campaignAngles) {
      const copy = angle.copy({
        store,
        origin: "https://m.test",
        bundle,
        products: [products[0]!],
        tipId: null,
      });
      expect(copy.caption).not.toMatch(/خصم|عرض خاص|ببلاش|الأرخص|أصلي/u);
    }
  });
});

describe("product discovery", () => {
  it("shows one real product with its store price and a link to its page", () => {
    const plan = planCampaigns({
      startDate: "2026-11-01",
      days: 14,
      products,
      store,
    });
    const discovery = plan.find((c) => c.type === "product_discovery")!;
    expect(discovery.productIds).toHaveLength(1);
    expect(discovery.pose).toBeNull();
    const product = products.find((p) => p.id === discovery.productIds[0])!;
    const copy = campaignCopy(
      discovery,
      { store, origin: "https://www.maytha.app" },
      [product],
    );
    expect(copy.caption).toContain(
      `https://www.maytha.app/products/${product.slug}`,
    );
    expect(
      checkCaption(
        copy.caption,
        allowedPrices([product], store),
        catalogText([product]),
      ).issues,
    ).toEqual([]);
  });
});

describe("a stored campaign against today's catalog", () => {
  const bundle = buildBundle(bundleThemes[0]!, products, store)!;

  it("is current while every item keeps its price and the rule is the same", () => {
    expect(bundleIsCurrent(bundle, products, store)).toBe(true);
  });

  it("is stale when an item's price changes, it is no longer sold, or the threshold changes", () => {
    const repriced = products.map((p) =>
      p.id === bundle.items[0]!.productId
        ? {
            ...p,
            variants: p.variants.map((v) => ({
              ...v,
              priceAgorot: v.priceAgorot + 100,
            })),
          }
        : p,
    );
    expect(bundleIsCurrent(bundle, repriced, store)).toBe(false);
    const gone = products.filter((p) => p.id !== bundle.items[1]!.productId);
    expect(bundleIsCurrent(bundle, gone, store)).toBe(false);
    expect(
      bundleIsCurrent(bundle, products, {
        ...store,
        freeDeliveryFromAgorot: 10_000,
      }),
    ).toBe(false);
    expect(refreshBundle(bundle, gone, store)).toBeNull();
  });
});

describe("another campaign for the same slot", () => {
  const plan = planCampaigns({
    startDate: "2026-11-01",
    days: 14,
    products,
    store,
  });

  it("changes the angle or the products, keeps the slot, and stays within the rules", () => {
    for (const current of plan) {
      const next = replanCampaign(current, { products, store });
      expect(next, current.angleId).not.toBeNull();
      expect(next!.scheduledFor).toEqual(current.scheduledFor);
      const changed =
        next!.angleId !== current.angleId ||
        next!.productIds.join() !== current.productIds.join() ||
        next!.tipId !== current.tipId;
      expect(changed, current.angleId).toBe(true);
      // The products it showed are not reused.
      for (const id of next!.productIds) {
        expect(current.productIds).not.toContain(id);
      }
    }
  });
});

describe("the 100 ₪ free-delivery rule", () => {
  const store100 = { ...store, freeDeliveryFromAgorot: 10_000 };

  it("plans free-delivery baskets that really reach 100 ₪ and says so", () => {
    const plan = planCampaigns({
      startDate: "2026-11-01",
      days: 28,
      products,
      store: store100,
    });
    for (const campaign of plan.filter((c) => c.type === "free_delivery")) {
      expect(campaign.bundle!.totalAgorot).toBeGreaterThanOrEqual(10_000);
      const used = products.filter((p) => campaign.productIds.includes(p.id));
      const copy = campaignCopy(
        campaign,
        { store: store100, origin: "https://www.maytha.app" },
        used,
      );
      expect(copy.caption).toContain("100 ₪");
      expect(copy.caption).not.toMatch(/50 ₪ وفوق|من 50 ₪/u);
    }
  });
});

describe("Arabic item counts", () => {
  it("uses the dual and plural forms", () => {
    expect(itemCount(2)).toBe("غرضين");
    expect(itemCount(3)).toBe("3 أغراض");
    expect(itemCount(11)).toBe("11 غرض");
  });
});
