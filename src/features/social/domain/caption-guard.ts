/**
 * The last check before a caption can be approved or published, whoever wrote it (template, AI or owner):
 * no invented discounts, offers, testimonials, rankings or guarantees, no price the catalog does not have,
 * and no delivery promise outside Maythaloun.
 */
export type CaptionIssue =
  | "empty"
  | "too_long"
  | "invented_offer"
  | "invented_testimonial"
  | "unverifiable_claim"
  | "delivery_outside_area"
  | "unknown_price"
  | "percentage"
  | "needs_evidence";

export interface CaptionCheck {
  ok: boolean;
  issues: CaptionIssue[];
}

export const MAX_CAPTION_LENGTH = 2_000;

const offerPatterns = [
  /خصم/u,
  /تخفيض/u,
  /تنزيلات/u,
  /عرض\s*(خاص|حصري|محدود|اليوم)/u,
  /عروض/u,
  /اشتر[يِ]?\s*\S+\s*و?\s*(خذ|احصل)/u,
  /هدية/u,
  /ببلاش/u,
  /\bsale\b/i,
  /\bdiscount\b/i,
  /\boff\b/i,
];

const testimonialPatterns = [
  /زبون(ة|ات)?\s*(قال|قالت|بيقول|تقول)/u,
  /آراء\s*(الزبائن|العملاء)/u,
  /تقييم/u,
  /⭐/u,
  /\breview/i,
];

const claimPatterns = [
  /الأفضل\s*(في|ب)/u,
  /الأرخص/u,
  /رقم\s*(1|١|واحد)/u,
  /مضمون/u,
  /ضمان/u,
  /يقضي\s*على\s*\d/u,
  /\d+\s*(٪|%)\s*(من\s*)?(الجراثيم|البكتيريا)/u,
  /معتمد\s*من/u,
];

/**
 * Claims the store may make only with evidence on file: authenticity, official distribution,
 * certification, and what a product does to germs. Flagged for the owner, never published as-is.
 */
const evidencePatterns = [
  /(^|[\s«"(])(ال)?أصل(ي|ية|يّة)(?=$|[\s.،!؟»")])/u,
  /منتجات\s*أصلية|بضاعة\s*أصلية/u,
  /(وكيل|موزّ?ع)\s*(ال)?(رسمي|معتمد|حصري)/u,
  /شهادة|مرخّ?ص|ترخيص/u,
  /(يقتل|يقضي\s*على|يزيل)\s*(\S+\s*)?(الجراثيم|البكتيريا|الفيروسات)/u,
  /\b(original|authentic|certified|genuine)\b/i,
];

const outsideAreaPatterns = [
  /(كل|جميع)\s*(المناطق|القرى|المدن|فلسطين|الضفة)/u,
  /لكل\s*(فلسطين|الضفة|المحافظات)/u,
  /توصيل\s*(لجنين|إلى\s*جنين|لكل)/u,
];

// «توصيل مجاني» is a real store rule only together with its threshold.
const freeWithoutThreshold = /(مجان[اًي]?|مجاناً)(?![^.\n]*\d+\s*₪)/u;

const priceMention = /(\d+(?:[.,٫]\d{1,2})?)\s*₪/gu;

function normalizePrice(raw: string): string {
  const value = Number(raw.replace(/[,٫]/u, "."));
  return `${Number.isInteger(value) ? value : value.toString()} ₪`;
}

/**
 * `catalogText` holds product names and variant labels exactly as the owner wrote them («تركيز 15%»);
 * quoting them verbatim is a fact, not a claim, so they are set aside before the checks run.
 */
export function checkCaption(
  caption: string,
  allowedPrices: ReadonlySet<string>,
  catalogText: readonly string[] = [],
): CaptionCheck {
  const issues = new Set<CaptionIssue>();
  let text = caption.trim();
  for (const fact of [...catalogText].sort((a, b) => b.length - a.length)) {
    if (fact.trim().length >= 3) text = text.split(fact).join(" ");
  }
  if (!text) issues.add("empty");
  if (text.length > MAX_CAPTION_LENGTH) issues.add("too_long");
  if (offerPatterns.some((pattern) => pattern.test(text))) {
    issues.add("invented_offer");
  }
  if (freeWithoutThreshold.test(text)) issues.add("invented_offer");
  if (testimonialPatterns.some((pattern) => pattern.test(text))) {
    issues.add("invented_testimonial");
  }
  if (claimPatterns.some((pattern) => pattern.test(text))) {
    issues.add("unverifiable_claim");
  }
  if (outsideAreaPatterns.some((pattern) => pattern.test(text))) {
    issues.add("delivery_outside_area");
  }
  if (/[٪%]/u.test(text)) issues.add("percentage");
  if (evidencePatterns.some((pattern) => pattern.test(text))) {
    issues.add("needs_evidence");
  }
  const normalizedAllowed = new Set(
    [...allowedPrices].map((price) =>
      normalizePrice(price.replace(/\s*₪/u, "")),
    ),
  );
  for (const match of text.matchAll(priceMention)) {
    if (!normalizedAllowed.has(normalizePrice(match[1]!))) {
      issues.add("unknown_price");
    }
  }
  return { ok: issues.size === 0, issues: [...issues] };
}

/** A sentence with no price and nothing the guard would stop, safe to quote from a product description. */
export function isNeutralSentence(sentence: string): boolean {
  return !/₪/u.test(sentence) && checkCaption(sentence, new Set()).ok;
}

export const captionIssueLabels: Record<CaptionIssue, string> = {
  empty: "النص فارغ.",
  too_long: "النص أطول من المسموح.",
  invented_offer: "يذكر خصماً أو عرضاً أو شيئاً مجانياً غير موجود في المتجر.",
  invented_testimonial: "يذكر آراء أو تقييمات زبائن غير موثّقة.",
  unverifiable_claim: "يحتوي ادعاءً لا يمكن إثباته (الأفضل، مضمون، نسب…).",
  delivery_outside_area: "يعد بتوصيل خارج ميثلون.",
  unknown_price: "يذكر سعراً غير موجود في الكتالوج.",
  percentage: "يحتوي نسبة مئوية.",
  needs_evidence:
    "فيه ادعاء بحاجة لإثبات (أصلي، وكيل رسمي، شهادة، يقتل الجراثيم…). احذفيه أو أرفقي الدليل قبل النشر.",
};
