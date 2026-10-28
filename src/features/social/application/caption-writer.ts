import "server-only";

import {
  isAiConfigured,
  requestStructuredJson,
} from "@/server/ai/openai-client";
import { formatIls } from "@/shared/lib/format-currency";

import type { CaptionWriter } from "./social-service";

const instructions = `أنت كاتب منشورات فيسبوك لمتجر «مايثا ماركت» في ميثلون (جنين).
اكتب بلهجة فلسطينية طبيعية ومهذبة. أعد صياغة المسودة فقط ولا تضف أي معلومة ليست فيها أو في الحقائق.
ممنوع: أي خصم أو عرض أو هدية أو شيء مجاني (إلا قاعدة التوصيل المجاني كما هي)، آراء أو تقييمات زبائن،
كلمات مثل الأفضل/الأرخص/مضمون، نسب مئوية، فوائد للمنتج غير مذكورة في الوصف، توصيل خارج ميثلون.
الأسعار تُكتب كما هي في الحقائق تماماً. أبقِ الروابط ورقم الواتساب والوسوم كما هي.`;

/** Optional nicer wording; the service keeps the template unless this output passes the caption guard. */
export function aiCaptionWriter(model: string): CaptionWriter | null {
  if (!isAiConfigured()) return null;
  return async ({ products, draft, catalog }) => {
    const facts = {
      products: products.map((product) => ({
        name: product.name,
        price: formatIls(product.priceAgorot),
        description: product.description,
      })),
      delivery: {
        area: catalog.store.deliveryAreaAr,
        fee: formatIls(catalog.store.deliveryFeeAgorot),
        freeFrom: formatIls(catalog.store.freeDeliveryFromAgorot),
      },
    };
    const result = await requestStructuredJson({
      model,
      schemaName: "facebook_caption",
      schema: {
        type: "object",
        additionalProperties: false,
        properties: { caption: { type: "string" } },
        required: ["caption"],
      },
      instructions,
      content: [
        {
          type: "input_text",
          text: `الحقائق:\n${JSON.stringify(facts)}\n\nالمسودة:\n${draft}`,
        },
      ],
      timeoutMs: 30_000,
    });
    const caption = (result as { caption?: unknown }).caption;
    return typeof caption === "string" ? caption : null;
  };
}
