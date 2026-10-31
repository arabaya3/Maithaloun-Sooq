const ar = {
  prefixLabels: {
    "970": "فلسطين +970",
    "972": "فلسطين/الداخل +972",
  },
  deliveryOnlyMaythalun: "التوصيل متاح حالياً داخل ميثلون فقط.",
  serviceNote: "التوصيل متاح حالياً داخل ميثلون فقط",
  reviewCartFirst: "راجع السلة قبل إرسال الطلب.",
  unreadableResult: "تعذّر قراءة نتيجة الطلب. لم تُمسح السلة.",
  connectionFailed: "تعذّر الاتصال بالخادم. لم تُمسح السلة.",
  loading: "جارٍ تحميل بيانات السلة…",
  eyebrow: "الدفع عند الاستلام",
  title: "بيانات الطلب",
  prefilled: "عبّأنا بياناتك من حسابك، ويمكنك تعديلها لهذا الطلب.",
  signInBefore: "يمكنك الطلب كضيف مباشرة، أو ",
  signIn: "تسجيل الدخول",
  signInAfter: " لتعبئة بياناتك.",
  errorTitle: "تعذّر إرسال الطلب",
  name: "الاسم",
  whatsappLegend: "رقم الواتساب",
  countryCode: "مفتاح الدولة",
  localNumber: "الرقم المحلي",
  whatsappHelp: "يُستخدم رقم الواتساب فقط لتأكيد الطلب وتنفيذ التوصيل.",
  honeypot: "اترك هذا الحقل فارغاً",
  contactNote:
    "بعد استلام الطلب سنتواصل معك عبر واتساب لتأكيد الطلب ومكان التوصيل داخل ميثلون.",
  paymentTitle: "طريقة الدفع",
  paymentText: "الدفع نقداً عند الاستلام",
  cartEmpty: "السلة فارغة. أضف منتجات أولاً.",
  unavailableProduct:
    "تحتوي السلة على منتج غير متاح حالياً أو بكمية أكبر من المتوفر.",
  unitReview:
    "تغيّرت طريقة شراء أحد المنتجات. راجع السلة واختر طريقة شراء متاحة.",
  submitting: "جارٍ إرسال الطلب…",
  submitWhatsApp: "إرسال الطلب عبر واتساب",
  submitWeb: "إرسال الطلب عبر الموقع",
  privacy: "تُستخدم هذه البيانات لتنفيذ هذا الطلب فقط.",
};

const en: typeof ar = {
  prefixLabels: {
    "970": "Palestine +970",
    "972": "+972",
  },
  deliveryOnlyMaythalun:
    "Delivery is currently available within Maythaloun only.",
  serviceNote: "Delivery is currently available within Maythaloun only",
  reviewCartFirst: "Review your cart before placing the order.",
  unreadableResult:
    "We couldn’t read the order result. Your cart has not been cleared.",
  connectionFailed:
    "We couldn’t reach the server. Your cart has not been cleared.",
  loading: "Loading your cart…",
  eyebrow: "Cash on delivery",
  title: "Your details",
  prefilled:
    "We’ve filled in your details from your account. You can edit them for this order.",
  signInBefore: "You can check out as a guest, or ",
  signIn: "sign in",
  signInAfter: " to fill in your details.",
  errorTitle: "Your order couldn’t be sent",
  name: "Full name",
  whatsappLegend: "WhatsApp number",
  countryCode: "Country code",
  localNumber: "Local number",
  whatsappHelp:
    "Your WhatsApp number is used only to confirm and deliver this order.",
  honeypot: "Leave this field empty",
  contactNote:
    "Once we receive your order, we’ll contact you on WhatsApp to confirm it and agree on the delivery spot within Maythaloun.",
  paymentTitle: "Payment method",
  paymentText: "Cash on delivery",
  cartEmpty: "Your cart is empty. Add some products first.",
  unavailableProduct:
    "Your cart contains a product that is unavailable or exceeds the available stock.",
  unitReview:
    "The way one of the products is sold has changed. Review your cart and choose an available option.",
  submitting: "Placing your order…",
  submitWhatsApp: "Place order via WhatsApp",
  submitWeb: "Place order",
  privacy: "These details are used only to fulfil this order.",
};

export const checkout = { ar, en };
