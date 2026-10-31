import { formatIls } from "@/shared/lib/format-currency";

import { shortProductName } from "./bundles";
import type { CampaignContext } from "./campaigns";

/**
 * The creative brief behind each angle: its name, the customer problem it answers, and two more
 * opening hooks the owner can choose instead of the default. Hooks use only store facts and the
 * campaign's own products and prices, so the caption guard holds for every choice.
 */
export interface AngleCreative {
  nameAr: string;
  problemAr: string;
  altHooks: (context: CampaignContext) => [string, string];
}

const productName = (context: CampaignContext) =>
  shortProductName(context.products[0]?.name ?? "");
const freeFrom = (context: CampaignContext) =>
  formatIls(context.store.freeDeliveryFromAgorot);

export const angleCreative: Record<string, AngleCreative> = {
  "trust-how-it-works": {
    nameAr: "كيف بنشتغل",
    problemAr: "التردد قبل أول طلب أونلاين",
    altHooks: ({ store }) => [
      "طلبكم من الموقع لباب البيت",
      `من ${store.deliveryAreaAr} لإلكم: طلب سهل وواضح`,
    ],
  },
  "repeat-restock": {
    nameAr: "قبل ما يخلص",
    problemAr: "الغرض بيخلص بنص شغل البيت",
    altHooks: (context) => [
      `لا تستنّوا ${productName(context)} يخلص`,
      `خلّوا ${productName(context)} احتياط بالبيت`,
    ],
  },
  "product-discovery": {
    nameAr: "تعرّفوا على منتج",
    problemAr: "ما بعرفوا إن المنتج متوفر عنا",
    altHooks: (context) => [
      `جرّبتوا ${productName(context)}؟`,
      `من رفوف مايثا: ${productName(context)}`,
    ],
  },
  "bundle-room-ready": {
    nameAr: "باكيج الغرفة",
    problemAr: "بننسى غرض أو اثنين وبنرجع نطلب",
    altHooks: ({ bundle }) => [bundle!.forAr, `${bundle!.nameAr} جاهز إلكم`],
  },
  "bundle-one-order": {
    nameAr: "طلب واحد بدل مشاوير",
    problemAr: "طلب كل غرض لحال متعب",
    altHooks: ({ bundle }) => [
      `ارتاحوا من المشاوير: ${bundle!.nameAr}`,
      `${bundle!.nameAr} بطلب واحد`,
    ],
  },
  "free-delivery-ready-basket": {
    nameAr: "سلة التوصيل المجاني",
    problemAr: "أجرة التوصيل على الطلبات الصغيرة",
    altHooks: (context) => [
      `جمّعوا ${freeFrom(context)} والتوصيل علينا`,
      `سلتكم ${formatIls(context.bundle!.totalAgorot)} والتوصيل علينا`,
    ],
  },
  "free-delivery-whats-missing": {
    nameAr: "شو ناقص بالبيت",
    problemAr: "طلبات صغيرة متفرقة",
    altHooks: (context) => [
      "قبل ما تطلبوا، شوفوا شو ناقص",
      `كمّلوا لـ ${freeFrom(context)} وارتاحوا من أجرة التوصيل`,
    ],
  },
  "mascot-meet-meetho": {
    nameAr: "تعرّفوا على ميثو",
    problemAr: "ما بعرفوا مايثا ماركت",
    altHooks: () => [
      "ميثو صاحبكم الجديد من ميثلون",
      "تعرّفوا على ميثو من مايثا ماركت",
    ],
  },
  "bundle-friday-reset": {
    nameAr: "تنظيفة الجمعة",
    problemAr: "نقص غرض بنص التنظيفة الكبيرة",
    altHooks: () => ["قبل ما تبلّشوا التنظيفة", "سلة التنظيفة الكبيرة جاهزة"],
  },
  "free-delivery-with-neighbours": {
    nameAr: "اطلبوا مع الجيران",
    problemAr: "الطلب الصغير لحاله ما بوصل للتوصيل المجاني",
    altHooks: ({ store }) => [
      "طلب واحد للحارة كلها",
      `سوا بتوصلوا للتوصيل المجاني من ${formatIls(store.freeDeliveryFromAgorot)}`,
    ],
  },
  "product-meetho-pick": {
    nameAr: "اختيار ميثو",
    problemAr: "ما بعرفوا شو في جديد بالمتجر",
    altHooks: () => ["ميثو اختارلكم هالمنتج", "جربتوا هاد قبل؟"],
  },
  "mascot-door-delivery": {
    nameAr: "ميثو بوصّل",
    problemAr: "ما في وقت للمشوار",
    altHooks: ({ store }) => [
      `من الموقع لباب بيتكم في ${store.deliveryAreaAr}`,
      "ميثو جاهز يوصّل طلبكم",
    ],
  },
  "awareness-order-from-home": {
    nameAr: "تسوّقوا من البيت",
    problemAr: "شراء أغراض التنظيف بياخذ وقت",
    altHooks: () => [
      "ناقصك شغلات للبيت؟ اطلبها من مايثا",
      "خلّي تنظيف البيت أسهل مع اختيارات مايثا",
    ],
  },
  "tip-meetho": {
    nameAr: "نصيحة ميثو",
    problemAr: "بدهم شغل البيت يكون أسهل",
    altHooks: () => ["ميثو عنده إلكم فكرة", "فكرة صغيرة بتسهّل شغل البيت"],
  },
  "tutorial-three-steps": {
    nameAr: "اطلبوا بثلاث خطوات",
    problemAr: "أول طلب أونلاين بيبيّن صعب",
    altHooks: () => [
      "أول مرة بتطلبوا أونلاين؟ سهلة",
      "من الموقع لبابكم بثلاث خطوات",
    ],
  },
  "engagement-what-first": {
    nameAr: "سؤال ميثو",
    problemAr: "حديث خفيف مع المتابعين",
    altHooks: () => [
      "المطبخ ولا الحمّام؟ جاوبوا ميثو",
      "شو أول غرفة بتنظفوها؟",
    ],
  },
};
