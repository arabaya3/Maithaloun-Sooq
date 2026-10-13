// Store information pages: short, plain and only what the store does today.
// No hours, addresses, registration numbers or promises the system can't keep.

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
  // {contact} in a text: the official number when configured, otherwise the order conversation.
  contactByNumber: (display: string) => `على رقم واتساب المتجر ⁦${display}⁩`,
  contactByConversation: "في محادثة الواتساب الخاصة بطلبك",
  officialWhatsAppTitle: "واتساب المتجر",
  officialWhatsAppText: "لأي سؤال عن المنتجات أو الطلبات، راسلنا على:",
  officialWhatsAppLabel: "رقم واتساب MAYTHA",
  // Shown on the contact page only while no store number is configured.
  whatsappUnavailable:
    "بعد إرسال طلبك نتواصل معك على واتساب، ويمكنك الرد في المحادثة نفسها بأي سؤال.",
  about: {
    title: "عن MAYTHA",
    description: "MAYTHA متجر صغير في ميثلون لمنتجات التنظيف والعناية.",
    sections: [
      {
        title: "من نحن",
        paragraphs: [
          "MAYTHA متجر صغير في ميثلون لمنتجات التنظيف والعناية الشخصية ومستلزمات البيت، نوصلها لبيتك داخل ميثلون.",
          "نختار منتجاتنا من ماركات بتعرفها وبتثق فيها، ونعرضها بأسمائها وصورها كما تصلنا.",
        ],
      },
      {
        title: "كيف تطلب",
        paragraphs: [
          "اختر منتجاتك وأرسل الطلب من الموقع أو عبر واتساب، ونتواصل معك على واتساب لتأكيد الطلب والتوصيل.",
          "الدفع نقداً عند الاستلام.",
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
    description: "كيف تتواصل مع MAYTHA.",
    sections: [
      {
        title: "بخصوص طلبك",
        paragraphs: [
          "بعد كل طلب نتواصل معك على رقم الواتساب الذي أدخلته لتأكيد الطلب والتوصيل.",
          "لأي سؤال أو طلب، مثل إلغاء طلب أو منتج وصلك تالفاً، راسلنا {contact} واذكر رقم الطلب. نرد بأسرع وقت ممكن.",
        ],
      },
    ],
  } satisfies InfoPage,
  delivery: {
    title: "التوصيل",
    description: "أين وكيف نوصل، وكم يكلف التوصيل.",
    sections: [
      {
        title: "أين ومتى",
        paragraphs: [
          "نوصل داخل ميثلون فقط، طوال أيام الأسبوع.",
          "نتفق معك على تفاصيل التوصيل عند تأكيد الطلب على واتساب.",
        ],
      },
      {
        title: "تكلفة التوصيل",
        paragraphs: [
          "مجاني إذا كان مجموع المنتجات {free} أو أكثر (دون رسوم التوصيل).",
          "إذا كان أقل من ذلك، التوصيل بـ {fee}.",
          "تظهر تكلفة التوصيل والإجمالي في السلة قبل إرسال الطلب.",
        ],
      },
      {
        title: "الدفع",
        paragraphs: ["نقداً عند الاستلام."],
      },
    ],
  } satisfies InfoPage,
  returns: {
    title: "المنتجات التالفة أو الخاطئة",
    description: "ماذا تفعل إذا وصلك منتج تالف أو غير الذي طلبته.",
    sections: [
      {
        title: "أبلغنا خلال 24 ساعة",
        paragraphs: [
          "إذا وصلك منتج تالف أو غير الذي طلبته، أبلغنا خلال 24 ساعة من الاستلام {contact}، مع رقم الطلب وصورة للمنتج إن أمكن.",
        ],
      },
      {
        title: "نستبدله لك",
        paragraphs: [
          "بعد التحقق، نستبدل المنتج ونوصل البديل بدون أي رسوم توصيل إضافية.",
          "المنتجات المفتوحة ننظر فيها حالة بحالة.",
          "هذا لا ينتقص من أي حق يكفله لك القانون.",
        ],
      },
    ],
  } satisfies InfoPage,
  privacy: {
    title: "الخصوصية",
    description: "ما البيانات التي نحفظها ولماذا.",
    sections: [
      {
        title: "ما نحفظه ولماذا",
        paragraphs: [
          "عند الطلب نحفظ اسمك ورقم الواتساب والمنتجات والأسعار، لننفذ طلبك ونتواصل معك ونحتفظ بسجل المبيعات، ما دام ذلك لازماً لعمل المتجر وبحسب ما يتطلبه القانون.",
          "لا نطلب أي بيانات بطاقات.",
          "السلة والمفضلة محفوظة في متصفحك، واختيارك للغة في ملف تعريف ارتباط (cookie).",
        ],
      },
      {
        title: "خدمات نستخدمها",
        paragraphs: [
          "الموقع وبيانات الطلبات مستضافة لدى مزودي خدمات سحابية على خوادم في الاتحاد الأوروبي.",
          "نتواصل معك عبر واتساب، ويخضع ذلك أيضاً لشروط واتساب وسياسة خصوصيته.",
          "قد يستخدم فريق المتجر أدوات ذكاء اصطناعي من مزود في الولايات المتحدة لإدارة المتجر، وقد تمر عليها بيانات مثل الطلبات وأسماء الزبائن.",
        ],
      },
      {
        title: "أسئلتك عن بياناتك",
        paragraphs: [
          "لأي سؤال عن بياناتك راسلنا {contact}.",
          "سجلات الطلبات، ومنها الاسم ورقم الواتساب، نحتفظ بها في سجل المبيعات، ولا يمكن حالياً تعديلها أو حذفها من نظام الطلبات.",
          "هذا لا ينتقص من أي حق يكفله لك القانون.",
        ],
      },
    ],
  } satisfies InfoPage,
  terms: {
    title: "الشروط",
    description: "شروط الطلب من MAYTHA باختصار.",
    sections: [
      {
        title: "الأسعار والعروض",
        paragraphs: [
          "الأسعار بالشيكل (₪)، ونحسب السعر النهائي ونتحقق من التوفر عند إرسال الطلب.",
          "العروض سارية خلال مدتها وبشروطها الظاهرة على المنتج.",
          "إذا ظهر خطأ واضح في سعر، نتواصل معك قبل تأكيد الطلب ويمكنك إلغاؤه.",
        ],
      },
      {
        title: "الطلب والتأكيد",
        paragraphs: [
          "نؤكد كل طلب معك على واتساب.",
          "إذا لم يتوفر منتج طلبته، نتواصل معك قبل أي تغيير، ولا نستبدله بغيره بدون موافقتك.",
        ],
      },
      {
        title: "إلغاء الطلب",
        paragraphs: [
          "يمكنك طلب إلغاء الطلب قبل خروجه للتوصيل، بمراسلتنا {contact}، ويصبح الإلغاء نافذاً بعد أن نؤكده.",
        ],
      },
      {
        title: "التوصيل والاستبدال",
        paragraphs: [
          "التوصيل داخل ميثلون فقط والدفع نقداً عند الاستلام، والتفاصيل في صفحة التوصيل.",
          "المنتجات التالفة أو الخاطئة نستبدلها كما في صفحة المنتجات التالفة أو الخاطئة.",
        ],
      },
      {
        title: "عام",
        paragraphs: [
          "قد نحدّث هذه الشروط، ويسري على كل طلب ما كان منشوراً عند إرساله. وهي لا تنتقص من أي حق يكفله لك القانون.",
        ],
      },
    ],
  } satisfies InfoPage,
};

const en: typeof ar = {
  heading: "Store information",
  pagesLabel: "Information pages",
  whatsappCta: "Message us on WhatsApp",
  contactByNumber: (display: string) =>
    `on the store's WhatsApp number ${display}`,
  contactByConversation: "in the WhatsApp conversation for your order",
  officialWhatsAppTitle: "WhatsApp",
  officialWhatsAppText:
    "For any question about products or orders, message us on:",
  officialWhatsAppLabel: "MAYTHA's WhatsApp number",
  whatsappUnavailable:
    "After you place an order we'll message you on WhatsApp, and you can reply in that conversation with any question.",
  about: {
    title: "About MAYTHA",
    description: "MAYTHA is a small home and care store in Maythaloun.",
    sections: [
      {
        title: "Who we are",
        paragraphs: [
          "MAYTHA is a small store in Maythaloun for cleaning products, personal care and household essentials, delivered to your door within Maythaloun.",
          "We choose our products from brands you know and trust, and show them with their names and photos as they reach us.",
        ],
      },
      {
        title: "How to order",
        paragraphs: [
          "Choose your products and place your order on the website or through WhatsApp; we'll message you on WhatsApp to confirm the order and delivery.",
          "You pay in cash on delivery.",
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
        title: "About your order",
        paragraphs: [
          "After every order we message you on the WhatsApp number you entered to confirm the order and delivery.",
          "For any question or request, such as cancelling an order or an item that arrived damaged, message us {contact} with your order number. We reply as soon as we can.",
        ],
      },
    ],
  },
  delivery: {
    title: "Delivery",
    description: "Where and how we deliver, and what it costs.",
    sections: [
      {
        title: "Where and when",
        paragraphs: [
          "We deliver within Maythaloun only, seven days a week.",
          "We agree the delivery details with you when we confirm your order on WhatsApp.",
        ],
      },
      {
        title: "Delivery cost",
        paragraphs: [
          "Free when your products total {free} or more (before delivery).",
          "Below that, delivery is {fee}.",
          "You'll see the delivery cost and total in your cart before you place the order.",
        ],
      },
      {
        title: "Payment",
        paragraphs: ["Cash on delivery."],
      },
    ],
  },
  returns: {
    title: "Damaged or incorrect items",
    description:
      "What to do if an item arrives damaged or isn't what you ordered.",
    sections: [
      {
        title: "Tell us within 24 hours",
        paragraphs: [
          "If an item arrives damaged or isn't what you ordered, let us know within 24 hours of delivery {contact}, with your order number and a photo if you can.",
        ],
      },
      {
        title: "We'll replace it",
        paragraphs: [
          "Once we've checked, we replace the item and deliver the replacement with no extra delivery fee.",
          "Opened items are looked at case by case.",
          "This doesn't limit any rights you have under the law.",
        ],
      },
    ],
  },
  privacy: {
    title: "Privacy",
    description: "What data we keep and why.",
    sections: [
      {
        title: "What we keep and why",
        paragraphs: [
          "When you order, we keep your name, WhatsApp number, the products and prices, so we can fulfil your order, contact you and keep our sales records, for as long as the store needs them and the law requires.",
          "We never ask for card details.",
          "Your cart and wishlist are saved in your browser, and your language choice in a cookie.",
        ],
      },
      {
        title: "Services we use",
        paragraphs: [
          "The website and order data are hosted by cloud providers on servers in the European Union.",
          "We contact you through WhatsApp, which also has its own terms and privacy policy.",
          "Store staff may use AI tools from a provider in the United States to run the store, and data such as orders and customer names may pass through them.",
        ],
      },
      {
        title: "Questions about your data",
        paragraphs: [
          "For any question about your data, message us {contact}.",
          "Order records, including your name and WhatsApp number, are kept in our sales records and can't currently be changed or deleted in our order system.",
          "This doesn't limit any rights you have under the law.",
        ],
      },
    ],
  },
  terms: {
    title: "Terms",
    description: "The terms for ordering from MAYTHA, in short.",
    sections: [
      {
        title: "Prices and offers",
        paragraphs: [
          "Prices are in Israeli shekels (₪); we calculate the final price and check availability when you place your order.",
          "Offers apply during their stated period and under the conditions shown on the product.",
          "If a price is clearly wrong, we'll contact you before confirming the order, and you can cancel it.",
        ],
      },
      {
        title: "Ordering and confirmation",
        paragraphs: [
          "We confirm every order with you on WhatsApp.",
          "If an item you ordered isn't available, we contact you before changing anything, and we never swap it for another without your agreement.",
        ],
      },
      {
        title: "Cancelling an order",
        paragraphs: [
          "You can ask to cancel an order before it leaves for delivery by messaging us {contact}; the cancellation takes effect once we confirm it.",
        ],
      },
      {
        title: "Delivery and replacements",
        paragraphs: [
          "Delivery is within Maythaloun only and you pay in cash on delivery; details are on the delivery page.",
          "Damaged or incorrect items are replaced as described on the damaged or incorrect items page.",
        ],
      },
      {
        title: "General",
        paragraphs: [
          "We may update these terms; each order follows the version published when it was placed. They don't limit any rights you have under the law.",
        ],
      },
    ],
  },
};

export const info = { ar, en };
