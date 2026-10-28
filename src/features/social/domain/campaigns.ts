import { formatIls } from "@/shared/lib/format-currency";

import {
  availableBundles,
  coreProductName,
  shortProductName,
  type Bundle,
} from "./bundles";
import { isNeutralSentence } from "./caption-guard";
import {
  callToAction,
  deliveryLine,
  hashtags,
  paymentLine,
  shoppingTips,
  type CaptionContext,
  type ShoppingTipId,
} from "./captions";
import {
  defaultWeeklySlots,
  storeInstant,
  weekdayOf,
  type WeeklySlot,
} from "./content-plan";
import type { PostFormat } from "./post-lifecycle";
import {
  formatSocialPrice,
  productUrl,
  type SocialProduct,
  type StoreFacts,
} from "./social-catalog";
import { addDays } from "@/shared/lib/store-time";

/**
 * The marketing layer: every post is a campaign with a reason to exist (objective, audience,
 * concept, call to action) and its own angle, layout and wording. Facts (prices, delivery, contact)
 * always come from the live catalog; the copy never adds an offer, ranking or claim of its own.
 */
export const campaignTypes = [
  "product_discovery",
  "weekly_deals",
  "bundle",
  "free_delivery",
  "store_awareness",
  "shopping_tutorial",
  "cleaning_tip",
  "seasonal",
  "engagement",
  "promo_reel",
  "mascot_story",
] as const;
export type CampaignType = (typeof campaignTypes)[number];

export const campaignTypeLabels: Record<CampaignType, string> = {
  product_discovery: "اكتشاف منتج",
  weekly_deals: "عروض الأسبوع",
  bundle: "باكيج",
  free_delivery: "توصيل مجاني",
  store_awareness: "تعريف بالمتجر",
  shopping_tutorial: "طريقة الطلب",
  cleaning_tip: "نصيحة تنظيف",
  seasonal: "مناسبة",
  engagement: "تفاعل",
  promo_reel: "ريل ترويجي",
  mascot_story: "قصة ميثو",
};

/**
 * Types that need data the store does not have yet are never planned: weekly deals need active
 * store offers, seasonal campaigns an owner-set occasion, savings comparisons verified evidence.
 */
export const plannableTypes: readonly CampaignType[] = [
  "product_discovery",
  "bundle",
  "free_delivery",
  "mascot_story",
  "store_awareness",
  "product_discovery",
  "cleaning_tip",
  "shopping_tutorial",
  "engagement",
];

export const campaignLayouts = [
  "product_spotlight",
  "bundle_board",
  "free_delivery_meter",
  "mascot_hero",
  "mascot_tip",
] as const;
export type CampaignLayout = (typeof campaignLayouts)[number];

/** ميثو's approved poses (src/features/social/assets/mascot). */
export const mascotPoses = [
  "presenting",
  "wave",
  "wink",
  "delivery",
  "tip",
  "shopping",
  "love",
] as const;
export type MascotPose = (typeof mascotPoses)[number];

export interface CampaignCopy {
  /** The big line on the image. */
  headline: string;
  /** One supporting line on the image. */
  subline: string;
  /** The button-like label on the image. */
  cta: string;
  caption: string;
}

export interface CampaignContext extends CaptionContext {
  bundle: Bundle | null;
  products: readonly SocialProduct[];
  tipId: ShoppingTipId | null;
}

export interface CampaignAngle {
  id: string;
  type: CampaignType;
  layout: CampaignLayout;
  pose: MascotPose | null;
  objective: string;
  audience: string;
  concept: string;
  /** What the angle needs from the plan. */
  needs: "product" | "bundle" | "free_delivery_bundle" | "tip" | "nothing";
  copy: (context: CampaignContext) => CampaignCopy;
}

function join(parts: Array<string | null | undefined | false>): string {
  return parts
    .filter((part) => part !== null && part !== undefined && part !== false)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** «غرضين», «3 أغراض», «11 غرض»: the Arabic count of items. */
export function itemCount(count: number): string {
  if (count === 1) return "غرض واحد";
  if (count === 2) return "غرضين";
  return count <= 10 ? `${count} أغراض` : `${count} غرض`;
}

const freeFrom = (store: StoreFacts) => formatIls(store.freeDeliveryFromAgorot);

function bundleLines(bundle: Bundle): string[] {
  return bundle.items.map(
    (item) =>
      `• ${coreProductName(item.name)}${item.variantLabel ? ` (${item.variantLabel})` : ""}: ${formatIls(item.priceAgorot)}`,
  );
}

function bundleTotalLine(bundle: Bundle, store: StoreFacts): string {
  return bundle.freeDelivery
    ? `المجموع ${formatIls(bundle.totalAgorot)}، يعني التوصيل مجاني لأنه فوق ${freeFrom(store)}.`
    : `المجموع ${formatIls(bundle.totalAgorot)}. ضيفوا عليه بـ ${formatIls(bundle.missingAgorot)} وبصير التوصيل مجاني من ${freeFrom(store)}.`;
}

function footer(context: CampaignContext, tags: readonly SocialProduct[] = []) {
  return ["", ...callToAction(context), "", hashtags(tags).join(" ")];
}

/** The first sentence of the owner's own description, when the caption guard finds nothing in it. */
function descriptionLine(product: SocialProduct): string | null {
  const sentence = product.description?.split(/\n|[.!؟]\s/u)[0]?.trim();
  return sentence && sentence.length <= 160 && isNeutralSentence(sentence)
    ? sentence
    : null;
}

export const campaignAngles: readonly CampaignAngle[] = [
  {
    id: "product-discovery",
    type: "product_discovery",
    layout: "product_spotlight",
    pose: null,
    objective: "تعريف الناس بمنتج حقيقي ممكن ما يعرفوا إنه عنا",
    audience: "اللي بشتروا هالنوع من المنتجات من محلات ثانية",
    concept: "منتج واحد بصورة كبيرة وواضحة، بسعره الحقيقي ورابط مباشر",
    needs: "product",
    copy: ({ products, store, origin }) => {
      const product = products[0]!;
      return {
        headline: shortProductName(product.name),
        subline: product.categoryName
          ? `من قسم ${product.categoryName}`
          : "من مايثا ماركت",
        cta: "اطلبوه من الموقع",
        caption: join([
          `✨ تعرّفوا على ${coreProductName(product.name)}`,
          descriptionLine(product),
          "",
          `💰 السعر: ${formatSocialPrice(product)}`,
          deliveryLine(store),
          "",
          ...callToAction({ store, origin }, productUrl(origin, product)),
          "",
          hashtags([product]).join(" "),
        ]),
      };
    },
  },
  {
    id: "bundle-room-ready",
    type: "bundle",
    layout: "bundle_board",
    pose: null,
    objective: "تكبير السلة بمجموعة كاملة لغرفة وحدة",
    audience: "العائلات اللي بتشتري أغراض التنظيف كل أسبوع",
    concept: "كل اللي بتحتاجه الغرفة، مختار إلكم، بأسعار المتجر الحقيقية",
    needs: "bundle",
    copy: ({ bundle, store, ...context }) => ({
      headline: bundle!.nameAr,
      subline: bundle!.forAr,
      cta: "اطلبوا الباكيج من الموقع",
      caption: join([
        `🧺 ${bundle!.nameAr}: ${bundle!.forAr}`,
        "",
        "جمعنالكم الأغراض اللي بتلزم مع بعض، كل واحد بسعره بالمتجر:",
        ...bundleLines(bundle!),
        "",
        bundleTotalLine(bundle!, store),
        paymentLine(store),
        ...footer({ bundle, store, ...context }),
      ]),
    }),
  },
  {
    id: "bundle-one-order",
    type: "bundle",
    layout: "bundle_board",
    pose: "shopping",
    objective: "تحويل اللي بشتروا غرض واحد لطلب كامل",
    audience: "اللي عادة بطلبوا منتج واحد كل مرة",
    concept: "ميثو حامل المجموعة: طلب واحد وكل الأغراض",
    needs: "bundle",
    copy: ({ bundle, store, ...context }) => ({
      headline: `${itemCount(bundle!.items.length)} بطلب واحد`,
      subline: `${bundle!.nameAr}: ${bundle!.forAr}`,
      cta: "جمّعوا طلبكم",
      caption: join([
        `🛒 ليش تطلبوا كل غرض لحال؟ ${bundle!.nameAr} بطلب واحد:`,
        "",
        ...bundleLines(bundle!),
        "",
        bundleTotalLine(bundle!, store),
        ...footer({ bundle, store, ...context }),
      ]),
    }),
  },
  {
    id: "free-delivery-ready-basket",
    type: "free_delivery",
    layout: "free_delivery_meter",
    pose: null,
    objective: "توضيح حد التوصيل المجاني بسلة واصلة له",
    audience: "زباين ميثلون اللي بطلبوا مبالغ صغيرة",
    concept: "سلة جاهزة فوق حد التوصيل المجاني، والمؤشر مليان",
    needs: "free_delivery_bundle",
    copy: ({ bundle, store, ...context }) => ({
      headline: `من ${freeFrom(store)} التوصيل علينا`,
      subline: `سلة جاهزة بتوصلكم للتوصيل المجاني من ${freeFrom(store)} داخل ${store.deliveryAreaAr}`,
      cta: "اطلبوا السلة كاملة",
      caption: join([
        `🚚 التوصيل داخل ${store.deliveryAreaAr} مجاني للطلبات من ${freeFrom(store)} وفوق، وتحت هيك بـ ${formatIls(store.deliveryFeeAgorot)} بس.`,
        "",
        "سلة جاهزة من أغراض البيت اللي بتخلص بسرعة:",
        ...bundleLines(bundle!),
        "",
        bundleTotalLine(bundle!, store),
        ...footer({ bundle, store, ...context }),
      ]),
    }),
  },
  {
    id: "free-delivery-whats-missing",
    type: "free_delivery",
    layout: "free_delivery_meter",
    pose: "delivery",
    objective: "تشجيع الزباين يجمعوا احتياجاتهم بطلب واحد",
    audience: "زباين على وشك يطلبوا طلب صغير",
    concept: "«شو ناقص بالبيت؟» وميثو حامل صندوق التوصيل",
    needs: "free_delivery_bundle",
    copy: ({ bundle, store, ...context }) => ({
      headline: "شو ناقص بالبيت؟",
      subline: `كمّلوا طلبكم، والتوصيل مجاني لباب البيت من ${freeFrom(store)}`,
      cta: "كمّلوا سلتكم",
      caption: join([
        "🤔 شو ناقص بالبيت هالأسبوع؟",
        "",
        deliveryLine(store),
        "مثلاً هيك سلة:",
        ...bundleLines(bundle!),
        bundleTotalLine(bundle!, store),
        ...footer({ bundle, store, ...context }),
      ]),
    }),
  },
  {
    id: "mascot-meet-meetho",
    type: "mascot_story",
    layout: "mascot_hero",
    pose: "presenting",
    objective: "تعريف الناس على ميثو وتثبيت اسم المتجر",
    audience: "أهل ميثلون اللي لسا ما بعرفوا المتجر",
    concept: "ميثو بعرّف عن حاله وعن أهم ثلاث أشياء",
    needs: "nothing",
    copy: ({ store, ...context }) => ({
      headline: "مرحبا، أنا ميثو!",
      subline: "صاحبكم من مايثا ماركت لكل أغراض تنظيف البيت",
      cta: "تعرّفوا على المتجر",
      caption: join([
        "👋 مرحبا! أنا ميثو، صاحبكم من مايثا ماركت.",
        "",
        "عنا منظفات وأغراض البيت، وبنوصلكم الطلب لحد الباب:",
        deliveryLine(store),
        paymentLine(store),
        ...footer({ store, ...context }),
      ]),
    }),
  },
  {
    id: "mascot-door-delivery",
    type: "mascot_story",
    layout: "mascot_hero",
    pose: "delivery",
    objective: "التوصيل للبيت سبب للطلب",
    audience: "البيوت المشغولة في ميثلون",
    concept: "ميثو بجيب الطلب للباب، والدفع عند الاستلام",
    needs: "nothing",
    copy: ({ store, ...context }) => ({
      headline: "طلبكم بيوصل لباب البيت",
      subline: store.cashOnDelivery
        ? `توصيل داخل ${store.deliveryAreaAr} والدفع عند الاستلام`
        : `توصيل داخل ${store.deliveryAreaAr}`,
      cta: "اطلبوا من البيت",
      caption: join([
        "📦 ميثو جاهز يجيبلكم طلبكم لحد الباب.",
        "",
        deliveryLine(store),
        paymentLine(store),
        ...footer({ store, ...context }),
      ]),
    }),
  },
  {
    id: "awareness-order-from-home",
    type: "store_awareness",
    layout: "mascot_hero",
    pose: "wave",
    objective: "التعريف بالمتجر: متجر أونلاين من البلد",
    audience: "مستخدمي الموبايل في ميثلون",
    concept: "تسوّق من البيت: من الموقع أو الواتساب، والتوصيل داخل البلد",
    needs: "nothing",
    copy: ({ store, ...context }) => ({
      headline: "تسوّقوا من البيت بسهولة",
      subline: store.whatsAppE164
        ? "من الموقع أو عالواتساب، وإحنا منوصّل"
        : "من الموقع، وإحنا منوصّل",
      cta: "زوروا الموقع",
      caption: join([
        "📱 مايثا ماركت متجر أونلاين من ميثلون لأغراض تنظيف البيت والعناية.",
        "",
        "اختاروا من الموقع واطلبوا بكم كبسة، أو ابعتولنا عالواتساب.",
        deliveryLine(store),
        ...footer({ store, ...context }),
      ]),
    }),
  },
  {
    id: "tip-meetho",
    type: "cleaning_tip",
    layout: "mascot_tip",
    pose: "tip",
    objective: "محتوى مفيد بنحفظ وبنشارك",
    audience: "اللي بدوروا على نصايح عملية للبيت",
    concept: "لمبة ميثو: نصيحة حقيقية للتسوق أو الاستعمال",
    needs: "tip",
    copy: ({ store, tipId, ...context }) => {
      const tip =
        shoppingTips.find((candidate) => candidate.id === tipId) ??
        shoppingTips[0];
      return {
        headline: "نصيحة ميثو",
        subline: tip.title,
        cta: "شاركوها مع أهلكم",
        caption: join([
          `💡 نصيحة ميثو: ${tip.title}`,
          "",
          tip.body(store),
          ...footer({ store, tipId, ...context }),
        ]),
      };
    },
  },
  {
    id: "tutorial-three-steps",
    type: "shopping_tutorial",
    layout: "mascot_tip",
    pose: "shopping",
    objective: "تسهيل أول طلب أونلاين",
    audience: "اللي عمرهم ما طلبوا أونلاين",
    concept: "ثلاث خطوات سهلة للطلب، وميثو بدلّكم",
    needs: "nothing",
    copy: ({ store, ...context }) => ({
      headline: "كيف تطلبوا بـ ٣ خطوات",
      subline: "اختاروا • ضيفوا للسلة • أكّدوا الطلب",
      cta: "جرّبوا هلّأ",
      caption: join([
        "🛒 أول مرة بتطلبوا أونلاين؟ سهلة:",
        "١. افتحوا الموقع واختاروا اللي بدكم إياه",
        "٢. ضيفوه للسلة",
        "٣. أكّدوا الطلب بعنوانكم",
        paymentLine(store),
        ...footer({ store, ...context }),
      ]),
    }),
  },
  {
    id: "engagement-what-first",
    type: "engagement",
    layout: "mascot_hero",
    pose: "wink",
    objective: "فتح حديث بالتعليقات",
    audience: "متابعين الصفحة",
    concept: "سؤال خفيف عن عادات التنظيف",
    needs: "nothing",
    copy: ({ store, ...context }) => ({
      headline: "سؤال ميثو لإلكم",
      subline: "بأي غرفة بتبلّشوا التنظيف؟ المطبخ ولا الحمّام؟",
      cta: "جاوبونا بالتعليقات",
      caption: join([
        "🤔 سؤال ميثو: بأي غرفة بتبلّشوا التنظيف؟",
        "اكتبولنا بالتعليقات 👇",
        ...footer({ store, ...context }),
      ]),
    }),
  },
];

export interface PlannedCampaign {
  date: string;
  time: string;
  scheduledFor: Date;
  format: PostFormat;
  type: CampaignType;
  angleId: string;
  layout: CampaignLayout;
  pose: MascotPose | null;
  objective: string;
  audience: string;
  concept: string;
  bundle: Bundle | null;
  tipId: ShoppingTipId | null;
  productIds: string[];
}

export interface CampaignPlanInput {
  startDate: string;
  days: number;
  products: readonly SocialProduct[];
  store: StoreFacts;
  recentProductIds?: ReadonlySet<string>;
  slots?: readonly WeeklySlot[];
}

/**
 * One round of the calendar, about two weeks of image slots: selling posts (bundles, free
 * delivery) balanced by brand, help and conversation posts. Leftover weight carries into the
 * next plan's first slots.
 */
const typeWeights: Partial<Record<CampaignType, number>> = {
  bundle: 2,
  free_delivery: 1,
  product_discovery: 1,
  mascot_story: 1,
  store_awareness: 1,
  cleaning_tip: 1,
  shopping_tutorial: 1,
  engagement: 1,
};

/** At most this share of posts shows the mascot, so he stays special. */
export const MAX_MASCOT_SHARE = 0.6;

/**
 * A balanced calendar: the type with the most remaining weight goes next unless it ran last time,
 * angles rotate before any repeats, a product is not shown again within 7 days, and the mascot
 * stays under its share. Image slots only for now; Reels join with the Reel phase.
 */
export function planCampaigns(input: CampaignPlanInput): PlannedCampaign[] {
  const slots = input.slots ?? defaultWeeklySlots;
  const recent = new Set(input.recentProductIds ?? []);
  const lastShown = new Map<string, number>();
  const remaining = new Map(
    Object.entries(typeWeights) as Array<[CampaignType, number]>,
  );
  const usedAngles = new Set<string>();
  const tipsLeft = [...shoppingTips.map((tip) => tip.id)];
  const plan: PlannedCampaign[] = [];
  let previous: CampaignType | null = null;
  let previousLayout: CampaignLayout | null = null;
  let mascotCount = 0;
  const themeUses = new Map<string, number>();

  for (let day = 0; day < input.days; day += 1) {
    const date = addDays(input.startDate, day);
    for (const slot of slots.filter(
      (candidate) =>
        candidate.weekday === weekdayOf(date) && candidate.format === "image",
    )) {
      const blockedProducts = new Set([
        ...recent,
        ...[...lastShown]
          .filter(([, shownDay]) => day - shownDay < 7)
          .map(([id]) => id),
      ]);
      const state: Parameters<typeof pickAngle>[0] = {
        remaining,
        previous,
        previousLayout,
        usedAngles,
        mascotAllowed:
          mascotCount < Math.floor((plan.length + 1) * MAX_MASCOT_SHARE),
        products: input.products,
        store: input.store,
        blockedProducts,
        tipsLeft,
        themeUses,
        productCursor: day + plan.length,
      };
      // The soft rules (mascot share, no repeat of the last type or layout) give way before a
      // slot is left empty.
      const choice =
        pickAngle(state) ??
        pickAngle({ ...state, mascotAllowed: true }) ??
        pickAngle({
          ...state,
          mascotAllowed: true,
          previous: null,
          previousLayout: null,
        });
      if (!choice) continue;
      const { angle, bundle, tipId, productId } = choice;
      usedAngles.add(angle.id);
      remaining.set(angle.type, (remaining.get(angle.type) ?? 0) - 1);
      // Once every type is spent, the next round of the calendar starts.
      if ([...remaining.values()].every((left) => left <= 0)) {
        for (const [type, weight] of Object.entries(typeWeights)) {
          remaining.set(type as CampaignType, weight);
        }
        usedAngles.clear();
      }
      if (angle.pose) mascotCount += 1;
      if (bundle) themeUses.set(bundle.themeId, plan.length);
      const productIds =
        bundle?.items.map((item) => item.productId) ??
        (productId ? [productId] : []);
      for (const id of productIds) lastShown.set(id, day);
      previous = angle.type;
      previousLayout = angle.layout;
      plan.push({
        date,
        time: slot.time,
        scheduledFor: storeInstant(date, slot.time),
        format: "image",
        type: angle.type,
        angleId: angle.id,
        layout: angle.layout,
        pose: angle.pose,
        objective: angle.objective,
        audience: angle.audience,
        concept: angle.concept,
        bundle,
        tipId,
        productIds,
      });
    }
  }
  return plan;
}

function pickAngle(state: {
  remaining: Map<CampaignType, number>;
  previous: CampaignType | null;
  previousLayout: CampaignLayout | null;
  usedAngles: ReadonlySet<string>;
  mascotAllowed: boolean;
  products: readonly SocialProduct[];
  store: StoreFacts;
  blockedProducts: ReadonlySet<string>;
  tipsLeft: ShoppingTipId[];
  /** When each bundle theme was last used, as a plan index. */
  themeUses: ReadonlyMap<string, number>;
  /** Where the rotation through the catalog starts, so plans do not all open with one product. */
  productCursor?: number;
  /** An angle that must not be picked again (its content would be identical). */
  excludeAngleId?: string;
}): {
  angle: CampaignAngle;
  bundle: Bundle | null;
  tipId: ShoppingTipId | null;
  productId?: string;
} | null {
  const types = [...state.remaining]
    .filter(([type, left]) => left > 0 && type !== state.previous)
    .sort((a, b) => b[1] - a[1])
    .map(([type]) => type);
  for (const type of types) {
    const angles = campaignAngles
      .filter(
        (angle) =>
          angle.type === type &&
          angle.id !== state.excludeAngleId &&
          (state.mascotAllowed || !angle.pose) &&
          angle.layout !== state.previousLayout,
      )
      .sort(
        (a, b) =>
          Number(state.usedAngles.has(a.id)) -
          Number(state.usedAngles.has(b.id)),
      );
    for (const angle of angles) {
      if (angle.needs === "product") {
        // Products with the owner's own description first, then a rotation through the catalog.
        const candidates = state.products
          .filter((product) => !state.blockedProducts.has(product.id))
          .sort(
            (a, b) =>
              Number(!descriptionLine(a)) - Number(!descriptionLine(b)) ||
              a.id.localeCompare(b.id),
          );
        if (!candidates.length) continue;
        const product =
          candidates[(state.productCursor ?? 0) % candidates.length]!;
        return { angle, bundle: null, tipId: null, productId: product.id };
      }
      if (angle.needs === "bundle" || angle.needs === "free_delivery_bundle") {
        const bundles = availableBundles(
          state.products.filter(
            (product) => !state.blockedProducts.has(product.id),
          ),
          state.store,
          { reachFreeDelivery: angle.needs === "free_delivery_bundle" },
        )
          .filter((bundle) =>
            angle.needs === "free_delivery_bundle" ? bundle.freeDelivery : true,
          )
          // The theme used longest ago (or never) first, so rooms rotate.
          .sort(
            (a, b) =>
              (state.themeUses.get(a.themeId) ?? -1) -
              (state.themeUses.get(b.themeId) ?? -1),
          );
        if (!bundles.length) continue;
        return { angle, bundle: bundles[0]!, tipId: null };
      }
      if (angle.needs === "tip") {
        const tipId = state.tipsLeft.shift() ?? shoppingTips[0].id;
        state.tipsLeft.push(tipId);
        return { angle, bundle: null, tipId };
      }
      return { angle, bundle: null, tipId: null };
    }
  }
  return null;
}

/**
 * Another campaign for the same slot, for «اقتراح حملة أخرى». The same type with a different
 * angle comes first, then another bundle theme or product; any other type only when nothing else
 * fits. The products it showed are kept out, so the new suggestion differs.
 */
export function replanCampaign(
  current: PlannedCampaign,
  input: {
    products: readonly SocialProduct[];
    store: StoreFacts;
    recentProductIds?: ReadonlySet<string>;
  },
): PlannedCampaign | null {
  const blockedProducts = new Set([
    ...(input.recentProductIds ?? []),
    ...current.productIds,
  ]);
  const base = {
    previous: null,
    previousLayout: null,
    usedAngles: new Set([current.angleId]),
    mascotAllowed: true,
    products: input.products,
    store: input.store,
    blockedProducts,
    tipsLeft: shoppingTips
      .map((tip) => tip.id)
      .filter((id) => id !== current.tipId),
    themeUses: new Map(
      current.bundle ? [[current.bundle.themeId, Number.MAX_SAFE_INTEGER]] : [],
    ),
    productCursor: 1,
    // An angle with fixed wording would come back identical: only one with a bundle, product or
    // tip may repeat, because its content changes.
    excludeAngleId:
      angleById(current.angleId)?.needs === "nothing"
        ? current.angleId
        : undefined,
  };
  const choice =
    pickAngle({ ...base, remaining: new Map([[current.type, 1]]) }) ??
    pickAngle({
      ...base,
      remaining: new Map(
        plannableTypes
          .filter((type) => type !== current.type)
          .map((type) => [type, typeWeights[type] ?? 1]),
      ),
    });
  if (!choice) return null;
  const { angle, bundle, tipId, productId } = choice;
  return {
    ...current,
    type: angle.type,
    angleId: angle.id,
    layout: angle.layout,
    pose: angle.pose,
    objective: angle.objective,
    audience: angle.audience,
    concept: angle.concept,
    bundle,
    tipId,
    productIds:
      bundle?.items.map((item) => item.productId) ??
      (productId ? [productId] : []),
  };
}

/** What a campaign post stores in social_posts.campaign: everything but its slot and products. */
export type StoredCampaign = Omit<
  PlannedCampaign,
  "date" | "time" | "scheduledFor" | "format" | "productIds"
>;

export function toStoredCampaign(campaign: PlannedCampaign): StoredCampaign {
  const {
    type,
    angleId,
    layout,
    pose,
    objective,
    audience,
    concept,
    bundle,
    tipId,
  } = campaign;
  return {
    type,
    angleId,
    layout,
    pose,
    objective,
    audience,
    concept,
    bundle,
    tipId,
  };
}

/** A stored campaign back in planner form, for its post's slot and products. */
export function fromStoredCampaign(
  stored: StoredCampaign,
  post: { scheduledFor: Date; productIds: readonly string[] },
): PlannedCampaign {
  return {
    ...stored,
    date: post.scheduledFor.toISOString().slice(0, 10),
    time: post.scheduledFor.toISOString().slice(11, 16),
    scheduledFor: post.scheduledFor,
    format: "image",
    productIds: [...post.productIds],
  };
}

/** Prices a bundle's caption may print: each item, the total and what is missing. */
export function bundlePrices(bundle: Bundle | null): string[] {
  if (!bundle) return [];
  return [
    formatIls(bundle.totalAgorot),
    formatIls(bundle.missingAgorot),
    ...bundle.items.map((item) => formatIls(item.priceAgorot)),
  ];
}

export function angleById(id: string): CampaignAngle | undefined {
  return campaignAngles.find((angle) => angle.id === id);
}

/** The copy of a planned campaign, from the live facts it was planned with. */
export function campaignCopy(
  campaign: PlannedCampaign,
  context: CaptionContext,
  products: readonly SocialProduct[],
): CampaignCopy {
  const angle = angleById(campaign.angleId);
  if (!angle) throw new Error("UNKNOWN_ANGLE");
  return angle.copy({
    ...context,
    bundle: campaign.bundle,
    products,
    tipId: campaign.tipId,
  });
}

/** Prices a campaign's caption may print: the catalog's, plus a bundle's real total and gap. */
export function campaignPrices(campaign: PlannedCampaign): string[] {
  return bundlePrices(campaign.bundle);
}
