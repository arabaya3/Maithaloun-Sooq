const ar = {
  siteDescription:
    "MAYTHA MARKET HOME & CARE — منتجات التنظيف والعناية من ماركات بتعرفها وبتثق فيها، مع توصيل داخل ميثلون.",
  categoriesTitle: "الأقسام",
  categoriesDescription: "تصفّح أقسام MAYTHA MARKET واختر ما يحتاجه البيت.",
  categoryMissing: "القسم غير موجود",
  offersTitle: "العروض",
  offersDescription: "المنتجات التي عليها عروض حالية في MAYTHA MARKET.",
  brandsTitle: "الماركات",
  brandsDescription: "الماركات المتوفرة في MAYTHA MARKET.",
  brandMissing: "الماركة غير موجودة",
  cartTitle: "سلة التسوق",
  cartDescription: "راجع المنتجات والكميات المحفوظة في سلة MAYTHA MARKET.",
  checkoutTitle: "إتمام الطلب",
  confirmationTitle: "تم استلام الطلب",
  productDescription: (name: string) => `تفاصيل ${name} في MAYTHA MARKET.`,
  productMissing: "المنتج غير موجود",
  accountTitle: "حسابي",
  favoritesTitle: "المفضلة",
  ordersTitle: "طلباتي",
  offlineTitle: "غير متصل",
  notFoundTitle: "الصفحة غير موجودة",
};

const en: typeof ar = {
  siteDescription:
    "MAYTHA MARKET HOME & CARE — cleaning and personal care from brands you know and trust, delivered within Maythaloun.",
  categoriesTitle: "Categories",
  categoriesDescription:
    "Browse MAYTHA MARKET categories and find what your home needs.",
  categoryMissing: "Category not found",
  offersTitle: "Offers",
  offersDescription: "Products with current offers at MAYTHA MARKET.",
  brandsTitle: "Brands",
  brandsDescription: "Brands available at MAYTHA MARKET.",
  brandMissing: "Brand not found",
  cartTitle: "Shopping cart",
  cartDescription:
    "Review the products and quantities saved in your MAYTHA MARKET cart.",
  checkoutTitle: "Checkout",
  confirmationTitle: "Order received",
  productDescription: (name: string) => `${name} at MAYTHA MARKET.`,
  productMissing: "Product not found",
  accountTitle: "My account",
  favoritesTitle: "Wishlist",
  ordersTitle: "My orders",
  offlineTitle: "Offline",
  notFoundTitle: "Page not found",
};

export const meta = { ar, en };
