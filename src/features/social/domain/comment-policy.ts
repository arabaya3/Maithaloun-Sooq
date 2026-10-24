import { formatIls } from "@/shared/lib/format-currency";

import type { StoreFacts } from "./social-catalog";

/**
 * Comments and messages: an automatic reply goes out only for a verified question about store rules
 * (delivery area and fee, payment, how to order). Anything about a specific case, money back,
 * a complaint, availability or personal details goes to the owner. When in doubt, escalate.
 */
export type EscalationReason =
  | "complaint"
  | "refund"
  | "delivery_dispute"
  | "availability"
  | "price_question"
  | "sensitive_information"
  | "unclear";

export const faqIds = [
  "delivery_area",
  "delivery_fee",
  "payment",
  "how_to_order",
] as const;
export type FaqId = (typeof faqIds)[number];

export type CommentDecision =
  | { action: "reply"; faqId: FaqId; reply: string }
  | { action: "escalate"; reason: EscalationReason }
  | { action: "none" };

const escalationRules: Array<{ reason: EscalationReason; pattern: RegExp }> = [
  {
    reason: "sensitive_information",
    pattern:
      /(\+?9[67]2|0)5\d[\s-]?\d{3}[\s-]?\d{4}|@[\w.-]+\.\w+|هويتي|رقم الهوية|بطاقة/u,
  },
  {
    reason: "refund",
    pattern:
      /(استرجاع|استرداد|ترجيع|رجّعوا|رجعولي|مصاري|فلوسي|بدي ارجع|refund)/iu,
  },
  {
    reason: "complaint",
    pattern:
      /(شكوى|زعلان|مش منيح|سيء|سيئ|خربان|مكسور|مغشوش|نصب|حرامي|مضروب|تالف|منتهي|scam)/iu,
  },
  {
    reason: "delivery_dispute",
    pattern:
      /(ما\s*وصل|ما\s*اجا|تأخر|متأخر|وين\s*الطلب|وين\s*طلبي|الطلب\s*ناقص|غلط\s*بالطلب|ناقصني)/u,
  },
  {
    reason: "availability",
    pattern:
      /(متوفر|موجود|في\s*عندكم|فيه\s*عندكم|عندكم\s*\S+\s*؟|خلص|نفذ|available)/iu,
  },
  {
    reason: "price_question",
    pattern: /(قديش|بكم|كم\s*سعر|السعر|سعره|سعرها|price)/iu,
  },
];

const faqRules: Array<{ id: FaqId; pattern: RegExp }> = [
  {
    id: "delivery_fee",
    pattern:
      /(اجرة|أجرة|حق|سعر|تكلفة|كلفة|قديش|بكم)\s*(ال)?توصيل|توصيل\s*(مجاني|ببلاش)/u,
  },
  {
    id: "delivery_area",
    pattern:
      /(بتوصلوا|توصلوا|بتوصّلوا|توصيل|بتوصل)\s*(على|ل|إلى|الى)?\s*\S*|وين\s*بتوصلوا/u,
  },
  {
    id: "payment",
    pattern: /(الدفع|ادفع|أدفع|بطاقة\s*ائتمان|كاش|فيزا|تحويل)/u,
  },
  {
    id: "how_to_order",
    pattern:
      /(كيف|شلون|وين)\s*(بطلب|اطلب|أطلب|بنطلب|الطلب)|بدي\s*اطلب|بدي\s*أطلب/u,
  },
];

export function faqAnswer(
  id: FaqId,
  store: StoreFacts,
  origin: string,
): string {
  const order = store.whatsAppE164
    ? `من الموقع ${origin} أو على واتساب ${store.whatsAppE164}`
    : `من الموقع ${origin}`;
  switch (id) {
    case "delivery_area":
      return `أهلاً فيك 🌿 التوصيل حالياً داخل ${store.deliveryAreaAr} فقط. بتقدر تطلب ${order}.`;
    case "delivery_fee":
      return `أهلاً فيك 🌿 التوصيل داخل ${store.deliveryAreaAr} بـ ${formatIls(store.deliveryFeeAgorot)}، ومجاني للطلبات من ${formatIls(store.freeDeliveryFromAgorot)} وفوق.`;
    case "payment":
      return store.cashOnDelivery
        ? "أهلاً فيك 🌿 الدفع نقداً عند الاستلام."
        : `أهلاً فيك 🌿 تفاصيل الدفع موجودة بصفحة الطلب على ${origin}.`;
    case "how_to_order":
      return `أهلاً فيك 🌿 بتقدر تطلب ${order}، والتوصيل داخل ${store.deliveryAreaAr}.`;
  }
}

const NOTHING_TO_ANSWER = /^[\p{Emoji}\p{P}\s]*$/u;
const thanks =
  /^(شكرا|شكراً|يسلمو|يعطيكم العافية|الله يعطيكم العافية|حلو|روعة|👍|❤️)[\s!.🌿❤️👍]*$/u;

export function decideComment(
  text: string,
  store: StoreFacts,
  origin: string,
): CommentDecision {
  const body = text.trim();
  if (!body || NOTHING_TO_ANSWER.test(body) || thanks.test(body)) {
    return { action: "none" };
  }
  for (const rule of escalationRules) {
    // «قديش التوصيل؟» asks about the store's fee, which has a verified answer.
    if (rule.reason === "price_question" && /توصيل/u.test(body)) continue;
    if (rule.pattern.test(body)) {
      return { action: "escalate", reason: rule.reason };
    }
  }
  const matches = faqRules.filter((rule) => rule.pattern.test(body));
  // One clear question gets one verified answer; a mix of questions is for the owner.
  if (
    matches.length === 1 ||
    (matches.length === 2 &&
      matches.some((m) => m.id === "delivery_fee") &&
      matches.some((m) => m.id === "delivery_area"))
  ) {
    const id = matches.some((m) => m.id === "delivery_fee")
      ? "delivery_fee"
      : matches[0]!.id;
    return { action: "reply", faqId: id, reply: faqAnswer(id, store, origin) };
  }
  if (/[؟?]/u.test(body) || matches.length > 1) {
    return { action: "escalate", reason: "unclear" };
  }
  return { action: "none" };
}

export const escalationLabels: Record<EscalationReason, string> = {
  complaint: "شكوى",
  refund: "طلب استرجاع",
  delivery_dispute: "مشكلة توصيل",
  availability: "سؤال عن التوفر",
  price_question: "سؤال عن سعر",
  sensitive_information: "معلومات شخصية",
  unclear: "سؤال يحتاج رداً منك",
};
