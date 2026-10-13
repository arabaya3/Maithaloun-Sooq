const ar = {
  siteDescription:
    "MAYTHA HOME & CARE — منتجات أصلية للتنظيف والعناية من ماركات بتعرفها، مع توصيل داخل ميثلون.",
  categoriesTitle: "الأقسام",
  categoriesDescription: "تصفّح أقسام MAYTHA واختر ما يحتاجه البيت.",
  categoryMissing: "القسم غير موجود",
  offersTitle: "العروض",
  offersDescription: "المنتجات التي عليها عروض حالية في MAYTHA.",
  brandsTitle: "الماركات",
  brandsDescription: "الماركات المتوفرة في MAYTHA.",
  brandMissing: "الماركة غير موجودة",
  cartTitle: "سلة التسوق",
  cartDescription: "راجع المنتجات والكميات المحفوظة في سلة MAYTHA.",
  checkoutTitle: "إتمام الطلب",
  confirmationTitle: "تم استلام الطلب",
  productDescription: (name: string) => `تفاصيل ${name} في MAYTHA.`,
  productMissing: "المنتج غير موجود",
  accountTitle: "حسابي",
  favoritesTitle: "المفضلة",
  ordersTitle: "طلباتي",
  offlineTitle: "غير متصل",
  notFoundTitle: "الصفحة غير موجودة",
};

const en: typeof ar = {
  siteDescription:
    "MAYTHA HOME & CARE — genuine cleaning and personal care products from brands you know, delivered within Maythaloun.",
  categoriesTitle: "Categories",
  categoriesDescription:
    "Browse MAYTHA categories and find what your home needs.",
  categoryMissing: "Category not found",
  offersTitle: "Offers",
  offersDescription: "Products with current offers at MAYTHA.",
  brandsTitle: "Brands",
  brandsDescription: "Brands available at MAYTHA.",
  brandMissing: "Brand not found",
  cartTitle: "Shopping cart",
  cartDescription:
    "Review the products and quantities saved in your MAYTHA cart.",
  checkoutTitle: "Checkout",
  confirmationTitle: "Order received",
  productDescription: (name: string) => `${name} at MAYTHA.`,
  productMissing: "Product not found",
  accountTitle: "My account",
  favoritesTitle: "Wishlist",
  ordersTitle: "My orders",
  offlineTitle: "Offline",
  notFoundTitle: "Page not found",
};

export const meta = { ar, en };
