import { describe, expect, it } from "vitest";

import { checkCaption } from "./caption-guard";
import {
  deliveryCaption,
  productCaption,
  tipCaption,
  shoppingTips,
} from "./captions";
import { decideComment } from "./comment-policy";
import { buildContentPlan, storeInstant } from "./content-plan";
import { classifyMetaError, isRetryable } from "./meta-errors";
import {
  approvalBlockers,
  canTransition,
  MAX_PUBLISH_ATTEMPTS,
  nextStatus,
  PostTransitionError,
  retryDelayMs,
} from "./post-lifecycle";
import {
  allowedPrices,
  catalogText,
  toSocialCatalog,
  type PublicCatalog,
  type SocialProduct,
} from "./social-catalog";

const image = {
  src: "https://x.supabase.co/a.webp",
  alt: "a",
  width: 10,
  height: 10,
};
function product(
  id: string,
  overrides: Partial<PublicCatalog["products"][number]> = {},
) {
  return {
    id,
    slug: id,
    name: `منتج ${id}`,
    nameAr: `منتج ${id}`,
    brand: null,
    categoryCode: id.startsWith("k") ? "kitchen-dishwashing" : "laundry",
    available: true,
    priceAgorot: 1000,
    image,
    description: "وصف المنتج كما كتبه المالك.",
    usageNotes: null,
    variants: [
      {
        id: `${id}-v`,
        label: "الافتراضي",
        available: true,
        image,
        sellingUnits: [{ priceAgorot: 1000, isDefault: true }],
      },
    ],
    ...overrides,
  };
}
const publicCatalog: PublicCatalog = {
  ok: true,
  store: {
    name: "MAYTHA MARKET",
    whatsAppE164: "+972599105456",
    delivery: {
      area: "maythalun",
      feeAgorot: 500,
      freeFromAgorot: 5000,
      payment: "cash_on_delivery",
    },
  },
  categories: [
    { code: "laundry", name: "الغسيل" },
    { code: "kitchen-dishwashing", name: "المطبخ والجلي" },
  ],
  products: [
    product("l1"),
    product("l2"),
    product("k1"),
    product("k2"),
    product("gone", { available: false }),
    product("noimg", { image: null }),
    product("varied", {
      variants: [
        {
          id: "a",
          label: "صغير",
          available: true,
          image,
          sellingUnits: [{ priceAgorot: 800, isDefault: true }],
        },
        {
          id: "b",
          label: "كبير",
          available: true,
          image,
          sellingUnits: [{ priceAgorot: 1500, isDefault: true }],
        },
        {
          id: "c",
          label: "نفد",
          available: false,
          image,
          sellingUnits: [{ priceAgorot: 100, isDefault: true }],
        },
      ],
    }),
  ],
};
const catalog = toSocialCatalog(publicCatalog);
const context = {
  store: catalog.store,
  origin: "https://maithaloun-sooq.vercel.app",
};
const byId = (id: string) =>
  catalog.products.find((p) => p.id === id) as SocialProduct;

describe("catalog integration", () => {
  it("advertises only available products with real photos, and prices from available variants", () => {
    expect(catalog.products.map((p) => p.id).sort()).toEqual([
      "k1",
      "k2",
      "l1",
      "l2",
      "varied",
    ]);
    const varied = byId("varied");
    expect(varied.priceAgorot).toBe(800);
    expect(varied.priceVaries).toBe(true);
    expect(varied.variants.map((v) => v.label)).toEqual(["صغير", "كبير"]);
    expect(catalog.knownProductIds.has("gone")).toBe(true);
  });
});

describe("captions", () => {
  it("build from catalog facts and pass the guard", () => {
    for (const caption of [
      productCaption(byId("varied"), context),
      deliveryCaption(context),
      ...shoppingTips.map((t) => tipCaption(t.id, context)),
    ]) {
      expect(
        checkCaption(caption, allowedPrices([byId("varied")], catalog.store))
          .issues,
      ).toEqual([]);
    }
    const caption = productCaption(byId("varied"), context);
    expect(caption).toContain("ابتداءً من 8 ₪");
    expect(caption).toContain(
      "https://maithaloun-sooq.vercel.app/products/varied",
    );
    expect(caption).toContain("#ميثلون");
  });

  it("guard blocks invented offers, testimonials, claims, foreign prices and delivery outside Maythaloun", () => {
    const prices = allowedPrices([byId("l1")], catalog.store);
    expect(checkCaption("خصم 20 على كل شي", prices).issues).toContain(
      "invented_offer",
    );
    expect(checkCaption("توصيل مجاني", prices).issues).toContain(
      "invented_offer",
    );
    expect(checkCaption("توصيل مجاني للطلبات من 50 ₪", prices).ok).toBe(true);
    expect(checkCaption("زبونة قالت إنه رائع", prices).issues).toContain(
      "invented_testimonial",
    );
    expect(checkCaption("الأفضل في السوق ومضمون", prices).issues).toContain(
      "unverifiable_claim",
    );
    expect(checkCaption("السعر 9 ₪", prices).issues).toContain("unknown_price");
    expect(checkCaption("السعر 10 ₪", prices).ok).toBe(true);
    expect(checkCaption("نوصل لكل فلسطين", prices).issues).toContain(
      "delivery_outside_area",
    );
    expect(checkCaption("يقتل 99% من الجراثيم", prices).ok).toBe(false);
  });

  it("guard accepts the owner's own product name verbatim, nothing more", () => {
    const named = { ...byId("l1"), name: "منظف تركيز 15%" };
    const prices = allowedPrices([named], catalog.store);
    expect(
      checkCaption("✨ منظف تركيز 15%", prices, catalogText([named])).ok,
    ).toBe(true);
    expect(
      checkCaption(
        "✨ منظف تركيز 15% وفعالية 99%",
        prices,
        catalogText([named]),
      ).ok,
    ).toBe(false);
  });
});

describe("publication state machine", () => {
  it("allows only approved posts to be claimed and never re-publishes", () => {
    expect(nextStatus("draft", "approve")).toBe("approved");
    expect(canTransition("draft", "claim")).toBe(false);
    expect(canTransition("rejected", "claim")).toBe(false);
    expect(nextStatus("approved", "claim")).toBe("publishing");
    expect(nextStatus("publishing", "succeed")).toBe("published");
    for (const event of [
      "claim",
      "approve",
      "retry_manually",
      "reopen",
      "edit",
    ] as const) {
      expect(canTransition("published", event)).toBe(false);
    }
    expect(() => nextStatus("published", "claim")).toThrow(PostTransitionError);
    expect(nextStatus("retry_wait", "claim")).toBe("publishing");
    expect(canTransition("approved", "edit")).toBe(false);
  });

  it("backs off exponentially, honours Meta's wait and caps attempts", () => {
    expect(retryDelayMs(1)).toBe(5 * 60_000);
    expect(retryDelayMs(2)).toBe(15 * 60_000);
    expect(retryDelayMs(9)).toBe(6 * 60 * 60_000);
    expect(retryDelayMs(1, 3_600_000)).toBe(3_600_000);
    expect(MAX_PUBLISH_ATTEMPTS).toBeGreaterThan(1);
  });

  it("lists every approval blocker", () => {
    expect(
      approvalBlockers({
        status: "draft",
        mediaStatus: "pending",
        captionOk: false,
        productsAvailable: false,
        campaignCurrent: true,
        scheduledFor: new Date(0),
        now: new Date(1),
      }),
    ).toEqual([
      "media_not_ready",
      "caption_blocked",
      "product_unavailable",
      "schedule_in_past",
    ]);
    expect(
      approvalBlockers({
        status: "draft",
        mediaStatus: "ready",
        captionOk: true,
        productsAvailable: true,
        campaignCurrent: true,
        scheduledFor: new Date(2),
        now: new Date(1),
      }),
    ).toEqual([]);
  });
});

describe("content plan", () => {
  it("schedules four posts and two Reels a week in store time, without repeating products early", () => {
    const plan = buildContentPlan({
      startDate: "2026-10-25",
      days: 7,
      products: catalog.products,
    });
    expect(plan.filter((i) => i.format === "image")).toHaveLength(4);
    expect(plan.filter((i) => i.format === "reel")).toHaveLength(2);
    expect(plan[0]!.scheduledFor.toISOString()).toBe(
      storeInstant("2026-10-25", "19:30").toISOString(),
    );
    // Palestine is UTC+2 in late October (after DST ends on the last Friday).
    expect(storeInstant("2026-10-25", "19:30").toISOString()).toBe(
      "2026-10-25T17:30:00.000Z",
    );
    const singles = plan
      .filter((i) => i.kind === "product" && i.format === "image")
      .map((i) => i.productIds[0]);
    expect(new Set(singles).size).toBe(singles.length);
    for (const item of plan)
      for (const id of item.productIds)
        expect(catalog.products.some((p) => p.id === id)).toBe(true);
  });

  it("puts recently posted products at the back of the queue", () => {
    const plan = buildContentPlan({
      startDate: "2026-10-25",
      days: 1,
      products: catalog.products,
      recentProductIds: new Set(["k1", "k2", "l1", "l2"]),
    });
    expect(plan[0]!.productIds).toEqual(["varied"]);
  });
});

describe("community management", () => {
  const reply = (text: string) =>
    decideComment(text, catalog.store, context.origin);
  it("answers only verified store-rule questions", () => {
    expect(reply("قديش التوصيل؟")).toMatchObject({
      action: "reply",
      faqId: "delivery_fee",
    });
    expect(reply("بتوصلوا على جنين؟")).toMatchObject({
      action: "reply",
      faqId: "delivery_area",
    });
    expect(reply("كيف بطلب؟")).toMatchObject({
      action: "reply",
      faqId: "how_to_order",
    });
    const answer = reply("قديش التوصيل؟");
    expect(answer.action === "reply" && answer.reply).toContain("5 ₪");
  });

  it("escalates complaints, refunds, disputes, availability, prices and personal data", () => {
    expect(reply("بدي استرجاع مصاري")).toEqual({
      action: "escalate",
      reason: "refund",
    });
    expect(reply("المنتج خربان")).toEqual({
      action: "escalate",
      reason: "complaint",
    });
    expect(reply("الطلب ما وصل لهلأ")).toEqual({
      action: "escalate",
      reason: "delivery_dispute",
    });
    expect(reply("في عندكم فيري؟")).toEqual({
      action: "escalate",
      reason: "availability",
    });
    expect(reply("قديش سعر الشامبو؟")).toEqual({
      action: "escalate",
      reason: "price_question",
    });
    expect(reply("رقمي 0599123456 كلموني")).toEqual({
      action: "escalate",
      reason: "sensitive_information",
    });
    expect(reply("شو رأيكم بالطقس؟")).toEqual({
      action: "escalate",
      reason: "unclear",
    });
    expect(reply("يعطيكم العافية")).toEqual({ action: "none" });
  });
});

describe("Meta API errors", () => {
  it("classifies expiry, permissions, throttling and outages", () => {
    expect(classifyMetaError({ httpStatus: 400, code: 190 }).kind).toBe("auth");
    expect(classifyMetaError({ httpStatus: 403, code: 200 }).kind).toBe(
      "permission",
    );
    const throttled = classifyMetaError({
      httpStatus: 400,
      code: 32,
      retryAfterSeconds: 120,
    });
    expect(throttled).toMatchObject({
      kind: "rate_limit",
      retryAfterMs: 120_000,
    });
    expect(classifyMetaError({ httpStatus: 503 }).kind).toBe("transient");
    expect(classifyMetaError({ httpStatus: 400, code: 100 }).kind).toBe(
      "invalid_request",
    );
    expect(isRetryable(throttled)).toBe(true);
    expect(isRetryable(classifyMetaError({ httpStatus: 400, code: 190 }))).toBe(
      false,
    );
  });
});
