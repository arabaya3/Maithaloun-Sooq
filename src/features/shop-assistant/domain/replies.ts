import type { PublicQuote } from "@/features/commerce/public-quote";
import { formatIls } from "@/shared/lib/format-currency";

type Locale = "ar" | "en";

/** Fixed replies for the moments that must be exact; the AI never writes prices or totals itself. */
export const replies = {
  quoteSummary(quote: PublicQuote, locale: Locale): string {
    const ar = locale === "ar";
    const lines = quote.lines.map((line, index) => {
      const detail = [line.options, line.unit].filter(Boolean).join(" · ");
      return `${index + 1}. ${line.name}${detail ? ` (${detail})` : ""} × ${line.quantity} = ${formatIls(line.lineSubtotalAgorot)}`;
    });
    return [
      ...lines,
      "",
      `${ar ? "المجموع" : "Subtotal"}: ${formatIls(quote.itemsSubtotalAgorot)}`,
      `${ar ? "التوصيل" : "Delivery"}: ${formatIls(quote.deliveryFeeAgorot)}`,
      `${ar ? "الإجمالي" : "Total"}: ${formatIls(quote.totalAgorot)}`,
    ].join("\n");
  },

  confirmPrompt(
    quote: PublicQuote,
    details: { name: string; deliveryNote: string | null },
    locale: Locale,
  ): string {
    const ar = locale === "ar";
    return [
      ar ? "هذا ملخص طلبك:" : "Here is your order:",
      "",
      replies.quoteSummary(quote, locale),
      "",
      `${ar ? "الاسم" : "Name"}: ${details.name}`,
      ...(details.deliveryNote
        ? [`${ar ? "التوصيل إلى" : "Deliver to"}: ${details.deliveryNote}`]
        : []),
      ar
        ? "التوصيل داخل ميثلون، والدفع نقداً عند الاستلام."
        : "Delivery within Maythaloun, cash on delivery.",
      "",
      ar
        ? "إذا كل شي صحيح اكتب «نعم» لتأكيد الطلب، أو أخبرني بأي تعديل."
        : "If everything is right, reply “yes” to confirm, or tell me what to change.",
    ].join("\n");
  },

  orderPlaced(reference: string, locale: Locale): string {
    return locale === "ar"
      ? `تم تأكيد طلبك ✅\nرقم الطلب: ${reference}\nسنتواصل معك هنا لترتيب التوصيل. شكراً لك 🌿`
      : `Your order is confirmed ✅\nOrder number: ${reference}\nWe’ll message you here to arrange delivery. Thank you 🌿`;
  },

  cartRestored(quote: PublicQuote, locale: Locale): string {
    return locale === "ar"
      ? `أهلاً فيك 🌿 وصلنا طلبك من الموقع، وراجعنا الأسعار والتوفر الآن:\n\n${replies.quoteSummary(quote, locale)}\n\nلإتمام الطلب أرسل اسمك ومكان التوصيل داخل ميثلون.`
      : `Welcome 🌿 We got your order from the website and checked prices and stock just now:\n\n${replies.quoteSummary(quote, locale)}\n\nTo complete it, send your name and delivery place in Maythaloun.`;
  },

  cartProblem(code: string, locale: Locale): string {
    const ar = locale === "ar";
    if (code === "insufficient_stock") {
      return ar
        ? "الكمية المطلوبة من أحد المنتجات غير متوفرة حالياً. خبرني بكمية أقل أو منتج بديل."
        : "One of the items isn’t available in that quantity right now. Tell me a smaller quantity or another product.";
    }
    return ar
      ? "أحد المنتجات في طلبك تغيّر أو لم يعد متوفراً. خبرني شو بدك أعدّل."
      : "One of the items in your order changed or is no longer available. Tell me what to adjust.";
  },

  ordersNotOpen(locale: Locale): string {
    return locale === "ar"
      ? "تمام! حوّلت طلبك لفريق المتجر ليثبّتوه معك هنا بأقرب وقت. 🌿"
      : "Great! I've passed your order to the store team, who will confirm it with you here shortly. 🌿";
  },
  humanHandoff(locale: Locale): string {
    return locale === "ar"
      ? "تمام، حوّلت محادثتك لفريق المتجر وراح يرد عليك أحد قريباً هنا. 🌿"
      : "Sure, I’ve passed your chat to the store team. Someone will reply here soon. 🌿";
  },

  unavailable(locale: Locale): string {
    return locale === "ar"
      ? "عذراً، ما قدرت أجاوب الآن. فريق المتجر راح يشوف رسالتك ويرد عليك قريباً."
      : "Sorry, I can’t answer right now. The store team will see your message and reply soon.";
  },

  unsupportedNumber(locale: Locale, storeUrl: string): string {
    return locale === "ar"
      ? `الطلب عبر المحادثة متاح لأرقام فلسطين حالياً. تقدر تطلب من الموقع: ${storeUrl}`
      : `Ordering in chat is available for Palestinian numbers for now. You can order on the website: ${storeUrl}`;
  },
};
