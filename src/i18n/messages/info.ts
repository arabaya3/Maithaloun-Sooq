// Store information pages. Only owner-approved policies and facts the code enforces;
// anything still undecided (hours, contact details, retention periods) is left out.
// Pending legal sign-off before publishing: the cross-border disclosures (privacy), the replacement
// delivery promise (returns) and the pricing-error and terms-update clauses (terms).

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
  // {contact} in a policy text: the official number when configured, otherwise the order conversation.
  contactByNumber: (display: string) =>
    `على رقم واتساب المتجر الرسمي ⁦${display}⁩`,
  contactByConversation: "في محادثة الواتساب الخاصة بطلبك",
  officialWhatsAppTitle: "واتساب المتجر",
  officialWhatsAppText:
    "رقم واتساب MAYTHA الرسمي لأي سؤال عن المنتجات أو الطلبات:",
  officialWhatsAppLabel: "رقم واتساب MAYTHA الرسمي",
  // Shown on the contact page only while no store number is configured.
  whatsappUnavailable:
    "لم ننشر وسيلة تواصل عامة بعد. بعد إرسال طلبك نتواصل معك على واتساب، ويمكنك الرد في المحادثة نفسها لأي أمر يخص طلبك.",
  about: {
    title: "عن MAYTHA",
    description: "MAYTHA متجر في ميثلون لمنتجات التنظيف والعناية.",
    sections: [
      {
        title: "من نحن",
        paragraphs: [
          "MAYTHA متجر في ميثلون يوفّر منتجات التنظيف والعناية الشخصية ومستلزمات البيت، ويوصلها إلى البيوت داخل ميثلون.",
          "نختار ما نبيعه من ماركات بتعرفها، ونعرض المنتجات بأسمائها وصورها كما تصلنا، دون أي تعديل على العبوات.",
        ],
      },
      {
        title: "كيف نعمل",
        paragraphs: [
          "تختار منتجاتك من الموقع وترسل الطلب من الموقع أو عبر واتساب، ثم نتواصل معك على واتساب لتأكيد الطلب وتفاصيل التوصيل.",
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
        title: "بخصوص طلب",
        paragraphs: [
          "بعد كل طلب نتواصل معك على رقم الواتساب الذي أدخلته لتأكيد الطلب وتفاصيل التوصيل داخل ميثلون.",
          "لأي سؤال أو طلب يخص طلبك، مثل الإلغاء أو الإبلاغ عن منتج تالف، راسلنا {contact} واذكر رقم الطلب.",
          "واتساب هو وسيلة التواصل مع المتجر حالياً، ونرد على الرسائل في أقرب وقت ممكن.",
        ],
      },
    ],
  } satisfies InfoPage,
  delivery: {
    title: "التوصيل",
    description: "منطقة التوصيل وأيامه وتكلفته وطريقة الدفع في MAYTHA.",
    sections: [
      {
        title: "منطقة التوصيل وأيامه",
        paragraphs: [
          "نوصل الطلبات داخل ميثلون فقط.",
          "التوصيل متاح طوال أيام الأسبوع. نتفق معك على تفاصيل التوصيل عند تأكيد الطلب على واتساب.",
        ],
      },
      {
        title: "تكلفة التوصيل",
        paragraphs: [
          "التوصيل مجاني عندما يبلغ مجموع المنتجات في طلبك {free} أو أكثر، دون احتساب رسوم التوصيل.",
          "إذا كان مجموع المنتجات أقل من ذلك، تكلفة التوصيل {fee}.",
          "تظهر تكلفة التوصيل والإجمالي في السلة وصفحة الطلب قبل إرساله، وهي نفسها التي تُحسب على طلبك.",
        ],
      },
      {
        title: "الدفع",
        paragraphs: ["الدفع نقداً عند الاستلام."],
      },
    ],
  } satisfies InfoPage,
  returns: {
    title: "المنتجات التالفة أو الخاطئة",
    description: "ماذا تفعل إذا وصلك منتج تالف أو غير الذي طلبته من MAYTHA.",
    sections: [
      {
        title: "أبلغنا خلال 24 ساعة",
        paragraphs: [
          "إذا وصلك منتج تالف أو غير الذي طلبته، نرجو أن تبلغنا خلال 24 ساعة من استلام طلبك، حتى نتمكن من حل المشكلة بسرعة.",
          "راسلنا {contact}، واذكر رقم الطلب والمنتج المقصود، ويفضّل إرفاق صورة له.",
        ],
      },
      {
        title: "ما نقدّمه",
        paragraphs: [
          "بعد التحقق من أن المنتج تالف أو غير الذي طلبته، نستبدله لك ونوصل البديل دون أي رسوم توصيل إضافية.",
          "إذا كان المنتج مفتوحاً، ننظر في كل حالة على حدة متى كان المنتج تالفاً أو غير المطلوب.",
        ],
      },
      {
        title: "حقوقك",
        paragraphs: [
          "مهلة الـ24 ساعة لتسريع المعالجة فقط، ولا تنتقص من أي حق يكفله لك القانون المعمول به.",
        ],
      },
    ],
  } satisfies InfoPage,
  privacy: {
    title: "الخصوصية",
    description: "ما البيانات التي تجمعها MAYTHA ولماذا ومن يعالجها.",
    sections: [
      {
        title: "البيانات التي نجمعها ولماذا",
        paragraphs: [
          "عند إرسال طلب نحفظ اسمك ورقم الواتساب ورقم الطلب والمنتجات والكميات والأسعار وطريقة الطلب. نحتاجها لتنفيذ الطلب والتواصل معك بخصوصه وللاحتفاظ بسجلات المبيعات.",
          "يُتفق على مكان التوصيل في محادثة الواتساب.",
          "لا نطلب بيانات بطاقات، فالدفع نقداً عند الاستلام.",
        ],
      },
      {
        title: "ما يُحفظ على جهازك",
        paragraphs: [
          "تُحفظ السلة والمفضلة في متصفحك على جهازك.",
          "نحفظ اختيارك للغة في ملف تعريف ارتباط (cookie) لتظهر لك اللغة نفسها في زياراتك القادمة.",
        ],
      },
      {
        title: "من يعالج البيانات",
        paragraphs: [
          "يعمل الموقع على خدمات سحابية لاستضافة الموقع ولتخزين قاعدة البيانات والصور، على خوادم داخل الاتحاد الأوروبي، وتُحفظ بيانات الطلبات لديها.",
          "يتم التواصل حول الطلبات عبر واتساب، وإذا اخترت الطلب عبر واتساب تُرسل الرسالة من تطبيقك. يخضع التواصل عبر واتساب أيضاً لشروط خدمة واتساب وسياسة الخصوصية الخاصة بها.",
          "قد يستخدم فريق المتجر أدوات مساعدة تعمل بالذكاء الاصطناعي يقدّمها مزود خارجي في الولايات المتحدة، وقد تُرسَل إليها سجلات من المتجر مثل المنتجات والطلبات وأسماء الزبائن، فتُعالَج خارج فلسطين.",
        ],
      },
      {
        title: "مدة الاحتفاظ",
        paragraphs: [
          "نحتفظ ببيانات الطلبات للمدة التي تحتاجها إدارة المتجر وتنفيذ الطلبات، وبحسب ما تفرضه المتطلبات القانونية المعمول بها، مثل سجلات المحاسبة.",
        ],
      },
      {
        title: "طلبات الوصول أو التصحيح أو الحذف",
        paragraphs: [
          "يمكنك أن تطلب الاطلاع على بياناتك أو تصحيحها أو حذفها بمراسلتنا {contact}.",
          "سنرد على طلبك عبر واتساب. نحتفظ بسجلات الطلبات، ومنها الاسم ورقم الواتساب، لأغراض المحاسبة والمتطلبات القانونية، ولا يمكن حالياً تعديلها أو حذفها أو إخفاء الهوية فيها من نظام الطلبات. سنوضح لك عند طلبك ما يمكننا فعله وما يلزمنا الاحتفاظ به.",
          "هذا القيد التقني لا ينتقص من أي حق يكفله لك القانون المعمول به.",
        ],
      },
    ],
  } satisfies InfoPage,
  terms: {
    title: "الشروط والأحكام",
    description: "شروط الطلب من MAYTHA.",
    sections: [
      {
        title: "الأسعار والعروض",
        paragraphs: [
          "الأسعار بالشيكل (₪). يحسب المتجر سعر كل طلب ويتحقق من توفّر الكميات عند إرساله.",
          "العروض تسري خلال مدتها المعلنة وبالشروط الظاهرة على المنتج.",
        ],
      },
      {
        title: "تأكيد الطلب",
        paragraphs: ["نتواصل معك على واتساب لتأكيد كل طلب وتفاصيل التوصيل."],
      },
      {
        title: "المنتجات غير المتوفرة",
        paragraphs: [
          "إذا تعذّر توفير منتج طلبته، نتواصل معك قبل أي تغيير على الطلب. لا نستبدل منتجاً بآخر دون موافقتك.",
        ],
      },
      {
        title: "إلغاء الطلب",
        paragraphs: [
          "يمكنك طلب إلغاء الطلب قبل خروجه للتوصيل، بمراسلتنا {contact} وذكر رقم الطلب.",
          "يصبح الإلغاء نافذاً بعد أن يؤكده فريق المتجر.",
        ],
      },
      {
        title: "الأخطاء في الأسعار",
        paragraphs: [
          "إذا ظهر خطأ واضح في سعر منتج، نتواصل معك قبل تأكيد الطلب، ويمكنك إلغاؤه دون أي التزام.",
        ],
      },
      {
        title: "التوصيل والدفع",
        paragraphs: [
          "التوصيل داخل ميثلون فقط، والدفع نقداً عند الاستلام. التكلفة والأيام في صفحة التوصيل.",
        ],
      },
      {
        title: "المنتجات التالفة أو الخاطئة",
        paragraphs: [
          "إذا وصلك منتج تالف أو غير الذي طلبته، التفاصيل في صفحة المنتجات التالفة أو الخاطئة. هذه الشروط لا تنتقص من حقوقك بموجب القانون المعمول به.",
        ],
      },
      {
        title: "تحديث الشروط",
        paragraphs: [
          "قد نحدّث هذه الشروط، ويسري على كل طلب ما كان منشوراً عند إرساله.",
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
    `on our official WhatsApp number ${display}`,
  contactByConversation: "in the WhatsApp conversation for your order",
  officialWhatsAppTitle: "WhatsApp",
  officialWhatsAppText:
    "MAYTHA's official WhatsApp number for any question about products or orders:",
  officialWhatsAppLabel: "MAYTHA's official WhatsApp number",
  whatsappUnavailable:
    "We haven't published a public contact channel yet. After you place an order, we contact you on WhatsApp, and you can reply in that conversation about anything to do with your order.",
  about: {
    title: "About MAYTHA",
    description: "MAYTHA is a home and care store in Maythaloun.",
    sections: [
      {
        title: "Who we are",
        paragraphs: [
          "MAYTHA is a store in Maythaloun offering cleaning products, personal care and household essentials, delivered to homes within Maythaloun.",
          "We choose what we sell from brands you know, and show each product with its name and photos as it reaches us, without altering the packaging.",
        ],
      },
      {
        title: "How it works",
        paragraphs: [
          "Choose your products on the website and place your order on the site or through WhatsApp. We then contact you on WhatsApp to confirm the order and the delivery details.",
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
        title: "About an order",
        paragraphs: [
          "After every order we contact you on the WhatsApp number you entered to confirm the order and the delivery details within Maythaloun.",
          "For any question or request about your order, such as a cancellation or a damaged item, message us {contact} and include your order number.",
          "WhatsApp is currently how you can reach the store, and we reply as soon as we can.",
        ],
      },
    ],
  },
  delivery: {
    title: "Delivery",
    description: "Delivery area, days, cost and payment at MAYTHA.",
    sections: [
      {
        title: "Area and days",
        paragraphs: [
          "We deliver within Maythaloun only.",
          "Delivery is available seven days a week. We agree the delivery details with you when we confirm your order on WhatsApp.",
        ],
      },
      {
        title: "Delivery cost",
        paragraphs: [
          "Delivery is free when the products in your order total {free} or more, before delivery.",
          "If the products total less than that, delivery costs {fee}.",
          "The delivery cost and total are shown in the cart and at checkout before you place your order, and they are exactly what your order is charged.",
        ],
      },
      {
        title: "Payment",
        paragraphs: ["Payment is in cash on delivery."],
      },
    ],
  },
  returns: {
    title: "Damaged or incorrect items",
    description:
      "What to do if an item from MAYTHA arrives damaged or isn't what you ordered.",
    sections: [
      {
        title: "Tell us within 24 hours",
        paragraphs: [
          "If an item arrives damaged or isn't what you ordered, please let us know within 24 hours of receiving your order so we can sort it out quickly.",
          "Message us {contact} with your order number and the item concerned, ideally with a photo.",
        ],
      },
      {
        title: "What we offer",
        paragraphs: [
          "Once we've confirmed an item is damaged or isn't what you ordered, we replace it and deliver the replacement at no extra delivery charge.",
          "Opened items that are damaged or incorrect are reviewed case by case.",
        ],
      },
      {
        title: "Your rights",
        paragraphs: [
          "The 24-hour window is there to help us act quickly; it does not limit any rights you have under applicable law.",
        ],
      },
    ],
  },
  privacy: {
    title: "Privacy",
    description: "What MAYTHA collects, why, and who processes it.",
    sections: [
      {
        title: "What we collect and why",
        paragraphs: [
          "When you place an order we keep your name, WhatsApp number, order number, the products, quantities and prices, and how you ordered. We need these to fulfil your order, contact you about it and keep our sales records.",
          "The delivery spot is agreed in the WhatsApp conversation.",
          "We never ask for card details; payment is in cash on delivery.",
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
        title: "Who processes the data",
        paragraphs: [
          "The website runs on cloud services for website hosting and for database and image storage, on servers in the European Union, where order data is kept.",
          "We communicate about orders through WhatsApp; if you choose to order through WhatsApp, the message is sent from your own app. Messages sent through WhatsApp are also subject to WhatsApp's own terms and privacy policy.",
          "Store staff may use AI-based assistant tools from an external provider in the United States; store records such as products, orders and customer names may be sent to them and processed outside Palestine.",
        ],
      },
      {
        title: "How long we keep it",
        paragraphs: [
          "We keep order data for as long as we need it to run the store and fulfil orders, and as applicable legal requirements, such as accounting records, require.",
        ],
      },
      {
        title: "Access, correction or deletion",
        paragraphs: [
          "You can ask to see, correct or delete your data by messaging us {contact}.",
          "We'll reply on WhatsApp. We keep order records, including your name and WhatsApp number, for accounting and legal purposes, and they can't currently be changed, deleted or de-identified in our order system. When you ask, we'll explain what we can do and what we have to keep.",
          "This technical limitation does not limit any rights you have under applicable law.",
        ],
      },
    ],
  },
  terms: {
    title: "Terms and conditions",
    description: "Terms for ordering from MAYTHA.",
    sections: [
      {
        title: "Prices and offers",
        paragraphs: [
          "Prices are in Israeli shekels (₪). The store calculates each order's price and checks that the quantities are available when you place it.",
          "Offers apply during their stated period and under the conditions shown on the product.",
        ],
      },
      {
        title: "Order confirmation",
        paragraphs: [
          "We contact you on WhatsApp to confirm every order and its delivery details.",
        ],
      },
      {
        title: "Unavailable items",
        paragraphs: [
          "If an item you ordered can't be supplied, we contact you before changing your order. We never substitute a product without your agreement.",
        ],
      },
      {
        title: "Cancelling an order",
        paragraphs: [
          "You can ask to cancel an order before it leaves for delivery by messaging us {contact} with your order number.",
          "A cancellation takes effect once the store team confirms it.",
        ],
      },
      {
        title: "Pricing errors",
        paragraphs: [
          "If a product shows an obvious pricing error, we'll contact you before confirming the order, and you can cancel it at no cost.",
        ],
      },
      {
        title: "Delivery and payment",
        paragraphs: [
          "Delivery is within Maythaloun only, and payment is in cash on delivery. Costs and days are on the delivery page.",
        ],
      },
      {
        title: "Damaged or incorrect items",
        paragraphs: [
          "If an item arrives damaged or isn't what you ordered, see the damaged or incorrect items page. These terms do not limit your rights under applicable law.",
        ],
      },
      {
        title: "Updates to these terms",
        paragraphs: [
          "We may update these terms; each order is governed by the version published when it was placed.",
        ],
      },
    ],
  },
};

export const info = { ar, en };
