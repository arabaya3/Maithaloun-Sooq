import { FREE_DELIVERY_THRESHOLD_AGOROT } from "@/features/delivery/delivery-policy";
import { formatIls } from "@/shared/lib/format-currency";

// The banner reads the checkout threshold, so the advertised rule is always the one charged.
const freeFrom = formatIls(FREE_DELIVERY_THRESHOLD_AGOROT);

const ar = {
  loading: "جارٍ تحميل السلة…",
  emptyTitle: "سلتك فارغة",
  emptyText: "أضف احتياجاتك من المنتجات، وستظهر هنا.",
  continueShopping: "متابعة التسوق",
  reviewEyebrow: "مراجعة المنتجات",
  title: "سلة التسوق",
  clearCart: "إفراغ السلة",
  clearConfirm: "هل تريد إزالة جميع المنتجات من السلة؟",
  clearYes: "نعم، أفرغ السلة",
  cancel: "إلغاء",
  viewDetails: (name: string) => `عرض تفاصيل ${name}`,
  totalPieces: (count: number) => `إجمالي القطع: ${count}`,
  // The pack label sits between the two parts.
  packPriceBefore: "سعر «",
  packPriceAfter: "»: ",
  unitPrice: "سعر الوحدة: ",
  unavailable: "غير متاح حالياً ولا يدخل في المجموع.",
  limited: (max: number) =>
    `المتوفر الآن ${max} فقط من هذا الخيار. قلّل العدد لإكمال الطلب.`,
  reviewGroup: (name: string) => `مراجعة طريقة شراء ${name}`,
  reviewText:
    "تغيّرت طريقة الشراء لهذا المنتج منذ أضفته. اختر طريقة شراء متاحة، ولن يدخل في المجموع قبل ذلك.",
  noUnitAvailable: "لا توجد طريقة شراء متاحة لهذا المنتج حالياً.",
  remove: "إزالة",
  removeFromCart: (name: string) => `إزالة ${name} من السلة`,
  lineTotalUnavailable: (name: string) => `مجموع ${name} غير متاح`,
  lineTotal: (name: string, amount: string) => `مجموع ${name} ${amount}`,
  removedVariant:
    "الصنف الذي اخترته من هذا المنتج لم يعد يُباع. احذفه ثم اختر صنفًا آخر من صفحة المنتج.",
  chooseOtherVariant: "اختيار صنف آخر",
  deleteFromCart: "حذف من السلة",
  summaryTitle: "ملخص الطلب",
  orderLines: "منتجات الطلب",
  subtotal: "مجموع المنتجات",
  delivery: "التوصيل",
  total: "الإجمالي",
  pricesRechecked: "تُراجع الأسعار والتوفر مرة أخرى عند تأكيد الطلب.",
  reviewMarked: "راجع المنتجات المعلَّمة في السلة قبل المتابعة.",
  orderViaWhatsApp: "الطلب عبر واتساب",
  orderViaWeb: "الطلب عبر الموقع",
  whatsAppNote:
    "يفتح واتساب برسالة جاهزة فيها طلبك، اضغط إرسال وسنؤكده معك هناك.",
  whatsAppPreparing: "نجهّز رسالة طلبك…",
  whatsAppCartChanged:
    "تغيّر توفر أو سعر منتج في سلتك. راجع السلة ثم حاول مرة أخرى.",
  whatsAppFailed: "تعذّر تجهيز رسالة الطلب الآن. حاول مرة أخرى بعد قليل.",
  webNote: "يصل طلبك إلى المتجر وسنتواصل معك عبر واتساب.",
  freeDeliveryBanner: `توصيل مجاني للطلبات بقيمة ${freeFrom} أو أكثر`,
  freeDeliveryReached: "مبروك، حصلت على توصيل مجاني",
  freeDeliveryRemaining: (amount: string) =>
    `أضف ${amount} لتحصل على توصيل مجاني`,
};

const en: typeof ar = {
  loading: "Loading your cart…",
  emptyTitle: "Your cart is empty",
  emptyText: "Add the products you need and they will appear here.",
  continueShopping: "Continue shopping",
  reviewEyebrow: "Review your items",
  title: "Shopping cart",
  clearCart: "Empty cart",
  clearConfirm: "Remove all products from your cart?",
  clearYes: "Yes, empty the cart",
  cancel: "Cancel",
  viewDetails: (name) => `View details of ${name}`,
  totalPieces: (count) => `Total pieces: ${count}`,
  packPriceBefore: "Price per “",
  packPriceAfter: "”: ",
  unitPrice: "Unit price: ",
  unavailable: "Currently unavailable and not included in the total.",
  limited: (max) =>
    `Only ${max} of this option available right now. Reduce the quantity to complete your order.`,
  reviewGroup: (name) => `Review how to buy ${name}`,
  reviewText:
    "The way this product is sold has changed since you added it. Choose an available option; it won’t count towards the total until you do.",
  noUnitAvailable:
    "No purchase option is available for this product right now.",
  remove: "Remove",
  removeFromCart: (name) => `Remove ${name} from cart`,
  lineTotalUnavailable: (name) => `Total for ${name} unavailable`,
  lineTotal: (name, amount) => `Total for ${name} ${amount}`,
  removedVariant:
    "The option you chose for this product is no longer sold. Remove it, then pick another option on the product page.",
  chooseOtherVariant: "Choose another option",
  deleteFromCart: "Remove from cart",
  summaryTitle: "Order summary",
  orderLines: "Items in your order",
  subtotal: "Subtotal",
  delivery: "Delivery",
  total: "Total",
  pricesRechecked:
    "Prices and availability are checked again when you place your order.",
  reviewMarked: "Review the highlighted items in your cart before continuing.",
  orderViaWhatsApp: "Order via WhatsApp",
  orderViaWeb: "Order on the website",
  whatsAppNote:
    "Opens WhatsApp with your order already written. Tap send and we’ll confirm it there.",
  whatsAppPreparing: "Preparing your order message…",
  whatsAppCartChanged:
    "An item in your cart changed in price or availability. Review your cart and try again.",
  whatsAppFailed:
    "We couldn’t prepare your order message right now. Please try again shortly.",
  webNote: "Your order goes to the store and we’ll contact you on WhatsApp.",
  freeDeliveryBanner: `Free delivery on orders of ${freeFrom} or more`,
  freeDeliveryReached: "You’ve unlocked free delivery",
  freeDeliveryRemaining: (amount) => `Add ${amount} more for free delivery`,
};

export const cart = { ar, en };
