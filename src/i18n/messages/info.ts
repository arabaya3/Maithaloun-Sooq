// Store information pages. Only facts the store has confirmed or the code enforces;
// anything still undecided by the owner is left out rather than guessed.

export interface InfoSection {
  title: string;
  paragraphs: readonly string[];
}

export interface InfoPage {
  title: string;
  description: string;
  sections: readonly InfoSection[];
}

const ar = {
  heading: "معلومات المتجر",
  pagesLabel: "صفحات المعلومات",
  whatsappCta: "راسلنا على واتساب",
  whatsappUnavailable:
    "رقم واتساب المتجر غير منشور حالياً. بعد إرسال طلبك من الموقع يتواصل معك المتجر على رقمك.",
  about: {
    title: "عن MAYTHA",
    description: "MAYTHA متجر منزلي في ميثلون لمنتجات التنظيف والعناية.",
    sections: [
      {
        title: "من نحن",
        paragraphs: [
          "MAYTHA متجر في ميثلون يوفّر منتجات التنظيف والعناية الشخصية ومستلزمات البيت، ويوصلها إلى البيوت داخل ميثلون.",
          "نختار ما نبيعه من ماركات بتعرفها، ونعرض المنتجات بأسمائها وصورها الأصلية كما تصلنا، دون تعديل على العبوات.",
        ],
      },
      {
        title: "كيف نعمل",
        paragraphs: [
          "تختار منتجاتك من الموقع وترسل الطلب من الموقع أو عبر واتساب، ثم نتواصل معك على واتساب لتأكيد الطلب ومكان التوصيل.",
          "الدفع نقداً عند الاستلام، ولا نطلب أي بيانات بطاقات.",
        ],
      },
      {
        title: "الإدارة",
        paragraphs: ["يدير المتجر المهندس عايد ربايعة."],
      },
    ],
  } satisfies InfoPage,
  contact: {
    title: "تواصل معنا",
    description: "طرق التواصل مع MAYTHA.",
    sections: [
      {
        title: "واتساب",
        paragraphs: [
          "أسرع طريقة للتواصل معنا هي واتساب. اذكر رقم طلبك إن كان سؤالك عن طلب.",
        ],
      },
      {
        title: "بخصوص طلب",
        paragraphs: [
          "بعد كل طلب نتواصل معك على رقم الواتساب الذي أدخلته لتأكيد الطلب ومكان التوصيل داخل ميثلون.",
        ],
      },
    ],
  } satisfies InfoPage,
  delivery: {
    title: "التوصيل",
    description: "منطقة التوصيل وتكلفته وطريقة الدفع في MAYTHA.",
    sections: [
      {
        title: "منطقة التوصيل",
        paragraphs: ["نوصل الطلبات حالياً داخل ميثلون فقط."],
      },
      {
        title: "تكلفة التوصيل",
        paragraphs: [
          "التوصيل مجاني للطلبات التي يبلغ مجموع منتجاتها {free} أو أكثر.",
          "للطلبات الأقل من ذلك تكلفة التوصيل {fee}.",
          "تظهر تكلفة التوصيل والإجمالي في السلة وصفحة الطلب قبل إرساله.",
        ],
      },
      {
        title: "تأكيد الطلب",
        paragraphs: [
          "بعد استلام طلبك نتواصل معك على واتساب لتأكيد الطلب والاتفاق على مكان التوصيل داخل ميثلون.",
        ],
      },
      {
        title: "الدفع",
        paragraphs: ["الدفع نقداً عند الاستلام."],
      },
    ],
  } satisfies InfoPage,
  returns: {
    title: "الاستبدال",
    description: "سياسة استبدال المنتجات التالفة أو الخاطئة في MAYTHA.",
    sections: [
      {
        title: "متى نستبدل المنتج",
        paragraphs: ["إذا وصلك منتج تالف، أو منتج غير الذي طلبته، نستبدله لك."],
      },
      {
        title: "كيف تطلب الاستبدال",
        paragraphs: [
          "تواصل معنا على واتساب واذكر رقم الطلب والمنتج المقصود، ويفضّل إرفاق صورة له.",
        ],
      },
    ],
  } satisfies InfoPage,
  privacy: {
    title: "الخصوصية",
    description: "كيف تتعامل MAYTHA مع بياناتك.",
    sections: [
      {
        title: "البيانات التي نجمعها",
        paragraphs: [
          "عند إرسال طلب نحفظ اسمك ورقم الواتساب والمنتجات والكميات والأسعار، لننفّذ الطلب ونتواصل معك بخصوصه.",
          "لا نطلب بيانات بطاقات ولا نحفظها، فالدفع نقداً عند الاستلام.",
        ],
      },
      {
        title: "ما يُحفظ على جهازك",
        paragraphs: [
          "تُحفظ السلة والمفضلة في متصفحك على جهازك.",
          "نحفظ اختيارك للغة في ملف تعريف ارتباط (cookie) لتظهر لك اللغة نفسها في الزيارات القادمة.",
        ],
      },
      {
        title: "الطلب عبر واتساب",
        paragraphs: [
          "إذا اخترت الطلب عبر واتساب، تُرسل رسالة الطلب من تطبيق واتساب على جهازك إلى رقم المتجر.",
        ],
      },
      {
        title: "الاستضافة",
        paragraphs: [
          "يعمل الموقع على خدمات استضافة سحابية (Vercel وSupabase) تُحفظ فيها بيانات الطلبات.",
        ],
      },
      {
        title: "استخدام البيانات",
        paragraphs: [
          "نستخدم بياناتك لتنفيذ طلبك والتواصل معك بخصوصه، ولا نبيعها لأي جهة.",
        ],
      },
    ],
  } satisfies InfoPage,
  terms: {
    title: "الشروط والأحكام",
    description: "شروط الطلب من MAYTHA.",
    sections: [
      {
        title: "الأسعار",
        paragraphs: [
          "الأسعار بالشيكل (₪). يحسب المتجر سعر كل طلب ويتحقق من توفّر الكميات عند إرسال الطلب.",
          "العروض تسري خلال مدتها المعلنة وبالشروط الظاهرة على المنتج.",
        ],
      },
      {
        title: "الطلبات",
        paragraphs: [
          "يصبح الطلب مؤكداً بعد أن نتواصل معك ونؤكده. إذا تعذّر توفير منتج نتواصل معك قبل التوصيل.",
        ],
      },
      {
        title: "التوصيل والدفع",
        paragraphs: [
          "التوصيل داخل ميثلون فقط، والدفع نقداً عند الاستلام. تفاصيل التكلفة في صفحة التوصيل.",
        ],
      },
      {
        title: "الاستبدال",
        paragraphs: [
          "نستبدل المنتج التالف أو الخاطئ. التفاصيل في صفحة الاستبدال.",
        ],
      },
    ],
  } satisfies InfoPage,
};

const en: typeof ar = {
  heading: "Store information",
  pagesLabel: "Information pages",
  whatsappCta: "Message us on WhatsApp",
  whatsappUnavailable:
    "The store's WhatsApp number isn't published yet. After you place an order on the website, the store will contact you on your number.",
  about: {
    title: "About MAYTHA",
    description: "MAYTHA is a home and care store in Maythaloun.",
    sections: [
      {
        title: "Who we are",
        paragraphs: [
          "MAYTHA is a store in Maythaloun offering cleaning products, personal care and household essentials, delivered to homes within Maythaloun.",
          "We choose what we sell from brands you know, and show each product with its original name and photos as it reaches us, without altering the packaging.",
        ],
      },
      {
        title: "How it works",
        paragraphs: [
          "Choose your products on the website and place your order on the site or through WhatsApp. We then contact you on WhatsApp to confirm the order and the delivery spot.",
          "Payment is in cash on delivery, and we never ask for card details.",
        ],
      },
      {
        title: "Management",
        paragraphs: ["The store is managed by Eng. Ayed Rabaya."],
      },
    ],
  },
  contact: {
    title: "Contact us",
    description: "How to reach MAYTHA.",
    sections: [
      {
        title: "WhatsApp",
        paragraphs: [
          "WhatsApp is the quickest way to reach us. If your question is about an order, include its order number.",
        ],
      },
      {
        title: "About an order",
        paragraphs: [
          "After every order we contact you on the WhatsApp number you entered to confirm the order and the delivery spot within Maythaloun.",
        ],
      },
    ],
  },
  delivery: {
    title: "Delivery",
    description: "Delivery area, cost and payment at MAYTHA.",
    sections: [
      {
        title: "Delivery area",
        paragraphs: ["We currently deliver within Maythaloun only."],
      },
      {
        title: "Delivery cost",
        paragraphs: [
          "Delivery is free when your products total {free} or more.",
          "Below that, delivery costs {fee}.",
          "The delivery cost and total are shown in the cart and on the checkout page before you place your order.",
        ],
      },
      {
        title: "Order confirmation",
        paragraphs: [
          "Once we receive your order, we contact you on WhatsApp to confirm it and agree on the delivery spot within Maythaloun.",
        ],
      },
      {
        title: "Payment",
        paragraphs: ["Payment is in cash on delivery."],
      },
    ],
  },
  returns: {
    title: "Replacements",
    description: "MAYTHA's policy for damaged or wrong items.",
    sections: [
      {
        title: "When we replace an item",
        paragraphs: [
          "If an item arrives damaged, or isn't the item you ordered, we replace it.",
        ],
      },
      {
        title: "How to ask for a replacement",
        paragraphs: [
          "Contact us on WhatsApp with your order number and the item concerned, ideally with a photo of it.",
        ],
      },
    ],
  },
  privacy: {
    title: "Privacy",
    description: "How MAYTHA handles your data.",
    sections: [
      {
        title: "What we collect",
        paragraphs: [
          "When you place an order we keep your name, WhatsApp number, and the products, quantities and prices, so we can fulfil the order and contact you about it.",
          "We never ask for or store card details; payment is in cash on delivery.",
        ],
      },
      {
        title: "Stored on your device",
        paragraphs: [
          "Your cart and wishlist are kept in your browser on your device.",
          "We keep your language choice in a cookie so you see the same language on your next visit.",
        ],
      },
      {
        title: "Ordering through WhatsApp",
        paragraphs: [
          "If you choose to order through WhatsApp, the order message is sent from the WhatsApp app on your device to the store's number.",
        ],
      },
      {
        title: "Hosting",
        paragraphs: [
          "The website runs on cloud hosting services (Vercel and Supabase), where order data is stored.",
        ],
      },
      {
        title: "How we use your data",
        paragraphs: [
          "We use your data to fulfil your order and contact you about it, and we never sell it to anyone.",
        ],
      },
    ],
  },
  terms: {
    title: "Terms and conditions",
    description: "Terms for ordering from MAYTHA.",
    sections: [
      {
        title: "Prices",
        paragraphs: [
          "Prices are in Israeli shekels (₪). The store calculates each order's price and checks that the quantities are available when you place the order.",
          "Offers apply during their stated period and under the conditions shown on the product.",
        ],
      },
      {
        title: "Orders",
        paragraphs: [
          "An order is confirmed once we contact you and confirm it. If an item can't be supplied, we contact you before delivery.",
        ],
      },
      {
        title: "Delivery and payment",
        paragraphs: [
          "Delivery is within Maythaloun only, and payment is in cash on delivery. The cost is explained on the delivery page.",
        ],
      },
      {
        title: "Replacements",
        paragraphs: [
          "We replace damaged or wrong items. Details are on the replacements page.",
        ],
      },
    ],
  },
};

export const info = { ar, en };
