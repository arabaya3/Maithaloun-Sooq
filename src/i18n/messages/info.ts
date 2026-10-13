// Store information pages. Only owner-approved policies and facts the code enforces;
// anything still undecided (hours, contact details, retention periods) is left out.

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
          "لأي سؤال أو طلب يخص طلبك، مثل الإلغاء أو الإبلاغ عن منتج تالف، رد في محادثة الواتساب نفسها واذكر رقم الطلب.",
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
          "التوصيل مجاني عندما يبلغ مجموع المنتجات في طلبك {free} أو أكثر.",
          "إذا كان المجموع أقل من ذلك، تكلفة التوصيل {fee}.",
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
          "رد في محادثة الواتساب الخاصة بطلبك، واذكر رقم الطلب والمنتج المقصود، ويفضّل إرفاق صورة له.",
        ],
      },
      {
        title: "ما نقدّمه",
        paragraphs: [
          "الحل الذي نقترحه هو استبدال المنتج.",
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
          "يعمل الموقع على خدمات سحابية لاستضافة الموقع ولتخزين قاعدة البيانات والصور، وتُحفظ بيانات الطلبات لديها.",
          "يتم التواصل حول الطلبات عبر واتساب، وإذا اخترت الطلب عبر واتساب تُرسل الرسالة من تطبيقك.",
          "قد يستخدم فريق المتجر أدوات مساعدة تعمل بالذكاء الاصطناعي لإدارة المتجر، وقد تعالج سجلات المتجر مثل المنتجات والطلبات وأسماء الزبائن.",
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
          "يمكنك أن تطلب الاطلاع على بياناتك أو تصحيحها أو حذفها عبر محادثة الواتساب الخاصة بطلبك.",
          "نحذف ما لا يلزمنا الاحتفاظ به أو نزيل ما يدل على هويتك منه، وقد نحتفظ ببعض سجلات الطلبات إذا كانت مطلوبة لأغراض قانونية أو محاسبية.",
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
          "يمكنك طلب إلغاء الطلب قبل خروجه للتوصيل، بالرد في محادثة الواتساب الخاصة بطلبك وذكر رقم الطلب.",
          "يصبح الإلغاء نافذاً بعد أن يؤكده فريق المتجر.",
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
    ],
  } satisfies InfoPage,
};

const en: typeof ar = {
  heading: "Store information",
  pagesLabel: "Information pages",
  whatsappCta: "Message us on WhatsApp",
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
          "For any question or request about your order, such as a cancellation or a damaged item, reply in that same WhatsApp conversation and include your order number.",
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
          "Delivery is free when the products in your order total {free} or more.",
          "Below that, delivery costs {fee}.",
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
          "Reply in the WhatsApp conversation for your order with your order number and the item concerned, ideally with a photo.",
        ],
      },
      {
        title: "What we offer",
        paragraphs: [
          "Our proposed remedy is a replacement.",
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
          "The website runs on cloud services for website hosting and for database and image storage, where order data is kept.",
          "We communicate about orders through WhatsApp; if you choose to order through WhatsApp, the message is sent from your own app.",
          "Store staff may use AI-based assistant tools to run the store; these can process store records such as products, orders and customer names.",
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
          "You can ask to see, correct or delete your data through the WhatsApp conversation for your order.",
          "We delete or de-identify what we don't need to keep; some order records may have to be kept for legal or accounting reasons.",
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
          "You can ask to cancel an order before it leaves for delivery by replying in the WhatsApp conversation for your order with your order number.",
          "A cancellation takes effect once the store team confirms it.",
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
    ],
  },
};

export const info = { ar, en };
