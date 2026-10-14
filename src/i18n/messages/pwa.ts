const ar = {
  bannerTitle: "ثبّت MAYTHA MARKET",
  bannerText:
    "أضف المتجر إلى الشاشة الرئيسية للوصول إليه بسرعة. التثبيت اختياري.",
  install: "تثبيت التطبيق",
  later: "لاحقاً",
  installed: "التطبيق مثبّت على هذا الجهاز.",
  installOnPhone: "تثبيت التطبيق على الهاتف",
  // Storefront install steps; the admin sheet keeps its own Arabic copy.
  stepsTitle: "إضافة MAYTHA MARKET إلى الشاشة الرئيسية",
  steps: [
    "افتح زر المشاركة في المتصفح.",
    "اختر “إضافة إلى الشاشة الرئيسية”.",
    "اضغط “إضافة”.",
  ] as readonly string[],
  stepsOther: "في متصفحات أخرى: افتح قائمة المتصفح ثم اختر “تثبيت التطبيق”.",
};

const en: typeof ar = {
  bannerTitle: "Install MAYTHA MARKET",
  bannerText:
    "Add the store to your home screen for quick access. Installing is optional.",
  install: "Install app",
  later: "Later",
  installed: "The app is installed on this device.",
  installOnPhone: "Install the app on your phone",
  stepsTitle: "Add MAYTHA MARKET to your home screen",
  steps: [
    "Tap the Share button in your browser.",
    "Choose “Add to Home Screen”.",
    "Tap “Add”.",
  ],
  stepsOther:
    "In other browsers: open the browser menu, then choose “Install app”.",
};

export const pwa = { ar, en };
