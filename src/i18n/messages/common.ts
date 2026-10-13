const arPlural = new Intl.PluralRules("ar-PS");

const ar = {
  storeName: "MAYTHA",
  home: "الرئيسية",
  categories: "الأقسام",
  offers: "العروض",
  account: "حسابي",
  favorites: "المفضلة",
  cart: "السلة",
  brands: "الماركات",
  backHome: "العودة إلى الرئيسية",
  trustLine: "منظفات وعناية شخصية ومستلزمات للبيت، نوصلها داخل ميثلون.",
  deliveryAndCash: "توصيل داخل ميثلون · الدفع عند الاستلام",
  trustedBrands: "ماركات بتعرفها وبتثق فيها",
  deliveryInMaythalun: "توصيل داخل ميثلون",
  cashOnDelivery: "الدفع عند الاستلام",
  productCount: (count: number) => {
    const form = arPlural.select(count);
    if (form === "zero") return "لا منتجات";
    if (form === "one") return "منتج واحد";
    if (form === "two") return "منتجان";
    if (form === "few") return `${count} منتجات`;
    return `${count} منتجًا`;
  },
  languageSwitch: "English",
  languageSwitchLabel: "Switch to English",
  breadcrumb: "مسار التصفح",
};

const en: typeof ar = {
  storeName: "MAYTHA",
  home: "Home",
  categories: "Categories",
  offers: "Offers",
  account: "Account",
  favorites: "Wishlist",
  cart: "Cart",
  brands: "Brands",
  backHome: "Back to home",
  trustLine:
    "Cleaning, personal care and home essentials, delivered within Maythaloun.",
  deliveryAndCash: "Delivery within Maythaloun · Cash on delivery",
  trustedBrands: "Brands you know and trust",
  deliveryInMaythalun: "Delivery within Maythaloun",
  cashOnDelivery: "Cash on delivery",
  productCount: (count: number) =>
    count === 0
      ? "No products"
      : count === 1
        ? "1 product"
        : `${count} products`,
  languageSwitch: "عربي",
  languageSwitchLabel: "التحويل إلى العربية",
  breadcrumb: "Breadcrumb",
};

export const common = { ar, en };
