const ar = {
  received: "تم استلام الطلب",
  lastStepWhatsApp: "خطوة أخيرة: أرسل الطلب على واتساب",
  thanks: "شكراً، وصل طلبك إلى المتجر",
  statusLabel: "حالة الطلب: ",
  reference: "رقم الطلب",
  savedNoWhatsApp: "حُفظ طلبك وسيتواصل معك المتجر لتأكيده. احتفظ برقم الطلب.",
  reachedStore:
    "وصل طلبك إلى MAYTHA، وسنتواصل معك عبر واتساب لتأكيد الطلب ومكان التوصيل.",
  orderLines: "منتجات الطلب",
  subtotal: "مجموع المنتجات",
  deliveryCost: "تكلفة التوصيل",
  confirmedLater: "سيتم تأكيدها لاحقاً",
  total: "الإجمالي",
  paymentMethod: "طريقة الدفع",
  cashOnDelivery: "نقداً عند الاستلام",
  backToStore: "العودة إلى المتجر",
  accountSuggestion:
    "أنشئ حساباً لحفظ المفضلة، متابعة الطلبات وإعادة طلب مشترياتك بسهولة. يمكنك إضافة هذا الطلب لحسابك بعد تأكيد رقمك.",
  createAccount: "إنشاء حساب",
  handoffTitle: "أرسل الطلب على واتساب لتأكيده",
  handoffText:
    "حُفظ طلبك. إذا لم يفتح واتساب تلقائياً، استخدم أحد الأزرار التالية. يؤكد المتجر الطلب بعد وصول رسالتك.",
  openWhatsApp: "فتح واتساب",
  whatsAppWeb: "واتساب ويب",
  copyMessage: "نسخ الرسالة",
  copied: "نُسخت الرسالة. الصقها في محادثة المتجر.",
  copyFailed: "تعذّر النسخ تلقائياً. انسخ النص أدناه يدوياً.",
  messageText: "نص الرسالة",
  // Order API errors; the Arabic texts are the ones the API has always returned.
  errors: {
    unknownProduct:
      "تحتوي السلة على منتج لم يعد متاحاً. حدّث السلة وحاول مجدداً.",
    unavailableProduct:
      "أحد المنتجات غير متاح حالياً. عدّل السلة وحاول مجدداً.",
    sellingUnitChanged:
      "تغيّرت طريقة شراء أحد المنتجات. راجع السلة واختر طريقة شراء متاحة.",
    insufficientStock:
      "الكمية المطلوبة من أحد المنتجات أكبر من المتوفر حالياً. قلّل العدد وحاول مجدداً.",
    invalidServiceArea: "منطقة التوصيل المحددة غير متاحة حالياً.",
    whatsAppUnavailable:
      "الطلب عبر واتساب غير متاح الآن. أكمل الطلب من الموقع مباشرة.",
    idempotencyConflict: "تعذّر إعادة استخدام محاولة الطلب. ابدأ محاولة جديدة.",
    saveFailed: "تعذّر حفظ الطلب الآن. لم يتم إنشاء طلب جديد.",
    unsupportedFormat: "صيغة الطلب غير مدعومة.",
    tooLarge: "حجم الطلب أكبر من المسموح.",
    unreadable: "تعذّر قراءة بيانات الطلب.",
    reviewFields: "يرجى مراجعة الحقول المطلوبة.",
    tryLater: "تعذّر إرسال الطلب الآن. حاول لاحقاً.",
  },
};

const en: typeof ar = {
  received: "Order received",
  lastStepWhatsApp: "One last step: send your order on WhatsApp",
  thanks: "Thank you, your order has reached the store",
  statusLabel: "Order status: ",
  reference: "Order number",
  savedNoWhatsApp:
    "Your order is saved and the store will contact you to confirm it. Keep your order number.",
  reachedStore:
    "Your order has reached MAYTHA. We’ll contact you on WhatsApp to confirm it and agree on the delivery spot.",
  orderLines: "Items in your order",
  subtotal: "Subtotal",
  deliveryCost: "Delivery",
  confirmedLater: "To be confirmed",
  total: "Total",
  paymentMethod: "Payment method",
  cashOnDelivery: "Cash on delivery",
  backToStore: "Back to the store",
  accountSuggestion:
    "Create an account to save favourites, follow your orders and reorder easily. You can add this order to your account once your number is verified.",
  createAccount: "Create an account",
  handoffTitle: "Send your order on WhatsApp to confirm it",
  handoffText:
    "Your order is saved. If WhatsApp didn’t open automatically, use one of the buttons below. The store confirms your order once your message arrives.",
  openWhatsApp: "Open WhatsApp",
  whatsAppWeb: "WhatsApp Web",
  copyMessage: "Copy message",
  copied: "Message copied. Paste it into the store chat.",
  copyFailed: "Couldn’t copy automatically. Copy the text below manually.",
  messageText: "Message text",
  errors: {
    unknownProduct:
      "Your cart contains a product that is no longer available. Refresh your cart and try again.",
    unavailableProduct:
      "One of the products is currently unavailable. Update your cart and try again.",
    sellingUnitChanged:
      "The way one of the products is sold has changed. Review your cart and choose an available option.",
    insufficientStock:
      "The quantity requested for one of the products is more than we have in stock. Reduce it and try again.",
    invalidServiceArea:
      "The selected delivery area is not available right now.",
    whatsAppUnavailable:
      "Ordering via WhatsApp isn’t available right now. Please place your order on the website.",
    idempotencyConflict:
      "This order attempt can’t be reused. Please start a new attempt.",
    saveFailed:
      "We couldn’t save your order right now. No new order was created.",
    unsupportedFormat: "Unsupported request format.",
    tooLarge: "The order request is too large.",
    unreadable: "We couldn’t read the order details.",
    reviewFields: "Please check the highlighted fields.",
    tryLater: "Your order couldn’t be sent right now. Please try again later.",
  },
};

export const orders = { ar, en };
