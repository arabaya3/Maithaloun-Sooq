import { formatIls } from "@/shared/lib/format-currency";

import { isNeutralSentence } from "./caption-guard";
import {
  formatSocialPrice,
  productUrl,
  type SocialProduct,
  type StoreFacts,
} from "./social-catalog";

export const postKinds = [
  "product",
  "collection",
  "new_arrivals",
  "weekly_highlights",
  "shopping_tip",
  "delivery_info",
] as const;
export type PostKind = (typeof postKinds)[number];

export const reelTemplates = ["spotlight", "collection", "delivery"] as const;
export type ReelTemplate = (typeof reelTemplates)[number];

export const postKindLabels: Record<PostKind, string> = {
  product: "منتج واحد",
  collection: "مجموعة منتجات",
  new_arrivals: "وصل حديثاً",
  weekly_highlights: "مختارات الأسبوع",
  shopping_tip: "نصيحة تسوّق",
  delivery_info: "معلومات التوصيل",
};

export const reelTemplateLabels: Record<ReelTemplate, string> = {
  spotlight: "ريل منتج واحد",
  collection: "ريل مجموعة",
  delivery: "ريل التوصيل",
};

export interface CaptionContext {
  store: StoreFacts;
  origin: string;
}

const categoryTags: Record<string, string> = {
  laundry: "#غسيل",
  "kitchen-dishwashing": "#مطبخ",
  bathroom: "#حمام",
  "home-cleaners": "#تنظيف",
  "home-fragrances": "#معطرات",
  "personal-care": "#عناية_شخصية",
  "baby-care": "#أطفال",
  "carpet-upholstery": "#سجاد",
  "cleaning-tools": "#أدوات_تنظيف",
  "paper-tissues": "#محارم",
};

export function hashtags(products: readonly SocialProduct[]): string[] {
  const tags = ["#مايثا_ماركت", "#MAYTHA_MARKET", "#ميثلون", "#جنين"];
  for (const product of products) {
    const tag = categoryTags[product.categoryCode];
    if (tag && !tags.includes(tag)) tags.push(tag);
  }
  return tags.slice(0, 7);
}

function whatsAppLine(store: StoreFacts): string | null {
  return store.whatsAppE164 ? `📲 واتساب: ${store.whatsAppE164}` : null;
}

export function deliveryLine(store: StoreFacts): string {
  return `🚚 التوصيل داخل ${store.deliveryAreaAr} بـ ${formatIls(store.deliveryFeeAgorot)}، ومجاني للطلبات من ${formatIls(store.freeDeliveryFromAgorot)} وفوق.`;
}

function paymentLine(store: StoreFacts): string | null {
  return store.cashOnDelivery ? "💵 الدفع نقداً عند الاستلام." : null;
}

function callToAction(context: CaptionContext, url?: string): string[] {
  return [
    `🛒 اطلبوا من الموقع: ${url ?? context.origin}`,
    whatsAppLine(context.store),
  ].filter((line): line is string => Boolean(line));
}

/** The first sentence of the owner's own description, left out when it carries a claim the guard would stop. */
function shortDescription(product: SocialProduct): string | null {
  const text = product.description?.split(/\n|الاستعمال:/u)[0]?.trim();
  if (!text) return null;
  const sentence = text.split(/(?<=[.!؟])\s/u)[0]!.trim();
  return sentence.length > 220 || !isNeutralSentence(sentence)
    ? null
    : sentence;
}

function join(parts: Array<string | null | undefined | false>): string {
  return parts
    .filter((part): part is string => Boolean(part))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function productCaption(
  product: SocialProduct,
  context: CaptionContext,
): string {
  const variants =
    product.variants.length > 1
      ? `متوفر بأكثر من خيار: ${product.variants
          .slice(0, 4)
          .map((variant) => variant.label)
          .join("، ")}`
      : null;
  return join([
    `✨ ${product.name}`,
    "",
    shortDescription(product),
    variants,
    `💰 السعر: ${formatSocialPrice(product)}`,
    "",
    deliveryLine(context.store),
    ...callToAction(context, productUrl(context.origin, product)),
    "",
    hashtags([product]).join(" "),
  ]);
}

function productList(products: readonly SocialProduct[]): string[] {
  return products.map(
    (product) => `▫️ ${product.name} — ${formatSocialPrice(product)}`,
  );
}

export function collectionCaption(
  title: string,
  intro: string,
  products: readonly SocialProduct[],
  context: CaptionContext,
): string {
  return join([
    title,
    intro,
    "",
    ...productList(products),
    "",
    deliveryLine(context.store),
    paymentLine(context.store),
    ...callToAction(context),
    "",
    hashtags(products).join(" "),
  ]);
}

export function newArrivalsCaption(
  products: readonly SocialProduct[],
  context: CaptionContext,
): string {
  return collectionCaption(
    "🆕 وصل جديد على مايثا ماركت",
    "منتجات انضافت للمتجر هالفترة:",
    products,
    context,
  );
}

export function weeklyHighlightsCaption(
  products: readonly SocialProduct[],
  context: CaptionContext,
): string {
  return collectionCaption(
    "🌿 مختارات الأسبوع من مايثا ماركت",
    "شوية أغراض للبيت متوفرة هلأ:",
    products,
    context,
  );
}

/** Tips built only from store rules we can verify, never from product benefits. */
export const shoppingTips = [
  {
    id: "combine-order",
    title: "جمّعوا طلبكم بطلب واحد",
    body: (store: StoreFacts) =>
      `التوصيل داخل ${store.deliveryAreaAr} مجاني للطلبات من ${formatIls(store.freeDeliveryFromAgorot)} وفوق، فجمّعوا أغراضكم بطلب واحد.`,
  },
  {
    id: "read-label",
    title: "اقرأوا طريقة الاستعمال قبل",
    body: () =>
      "لكل منتج بالموقع صفحة فيها الوصف وطريقة الاستعمال زي ما هي على العبوة. اقرأوها قبل الاستعمال.",
  },
  {
    id: "order-whatsapp",
    title: "بتحبوا تطلبوا عالواتساب؟",
    body: (store: StoreFacts) =>
      store.whatsAppE164
        ? `ابعتولنا اسم المنتج على ${store.whatsAppE164} وبنرتبلكم الطلب.`
        : "اطلبوا مباشرة من الموقع.",
  },
  {
    id: "cash",
    title: "الدفع عند الاستلام",
    body: (store: StoreFacts) =>
      store.cashOnDelivery
        ? "ما في داعي لبطاقة؛ بتدفعوا نقداً لما يوصلكم الطلب."
        : "شوفوا طرق الدفع بصفحة الطلب.",
  },
] as const;
export type ShoppingTipId = (typeof shoppingTips)[number]["id"];

export function tipCaption(
  tipId: ShoppingTipId,
  context: CaptionContext,
): string {
  const tip =
    shoppingTips.find((candidate) => candidate.id === tipId) ?? shoppingTips[0];
  return join([
    `💡 نصيحة تسوّق: ${tip.title}`,
    "",
    tip.body(context.store),
    "",
    ...callToAction(context),
    "",
    hashtags([]).join(" "),
  ]);
}

export function deliveryCaption(context: CaptionContext): string {
  return join([
    "🚚 التوصيل من مايثا ماركت",
    "",
    deliveryLine(context.store),
    paymentLine(context.store),
    "",
    ...callToAction(context),
    "",
    hashtags([]).join(" "),
  ]);
}

export function reelCaption(
  template: ReelTemplate,
  products: readonly SocialProduct[],
  context: CaptionContext,
): string {
  if (template === "spotlight" && products[0]) {
    return productCaption(products[0], context);
  }
  if (template === "delivery") return deliveryCaption(context);
  return weeklyHighlightsCaption(products, context);
}
