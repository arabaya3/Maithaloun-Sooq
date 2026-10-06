const actionLabels: Readonly<Record<string, string>> = {
  login: "دخول",
  logout: "خروج",
  password_change: "تغيير كلمة المرور",
  session_revoke: "إنهاء جلسة جهاز",
  operator_create: "إنشاء حساب موظفة",
  operator_rotate: "تحديث حساب موظفة",
  operator_enable: "تفعيل حساب موظفة",
  operator_disable: "إيقاف حساب موظفة",
  order_status_change: "تغيير حالة طلب",
  stock_adjustment: "تعديل مخزون",
  stock_transfer: "نقل مخزون",
  reorder_threshold_update: "تعديل حد الطلب",
  purchase_post: "تسجيل فاتورة شراء",
  supplier_payment: "دفعة لمورد",
  extraction_create: "رفع فاتورة للمراجعة",
  extraction_confirm: "تأكيد فاتورة مراجَعة",
  extraction_discard: "إلغاء فاتورة مراجَعة",
  price_review_decision: "قرار سعر بيع",
  sale_post: "تسجيل بيع",
  sale_cancel: "إلغاء فاتورة بيع",
  customer_payment: "دفعة من زبون",
  customer_payment_reversal: "عكس دفعة زبون",
  customer_balance_adjustment: "تسوية رصيد زبون",
  reminder_state_update: "تعديل تذكير دين",
  settings_update: "تعديل الإعدادات",
  service_area_update: "تعديل منطقة التوصيل",
  product_publication: "تغيير نشر منتج",
  product_category_move: "نقل منتج لقسم آخر",
  category_reorder: "تغيير ترتيب الأقسام",
  assistant_smoke_test: "فحص المساعد",
  qa_stock_simulation: "محاكاة مخزون للاختبار",
  qa_probe_create: "إنشاء فحص اختبار",
  qa_order_create: "إنشاء طلب اختبار",
};

export const auditEntityLabels: Readonly<Record<string, string>> = {
  admin_user: "حساب",
  product: "منتج",
  product_variant: "صنف",
  product_specification: "مواصفة",
  product_category: "قسم",
  order: "طلب",
  inventory_item: "مخزون",
  purchase_invoice: "فاتورة شراء",
  supplier: "مورد",
  extraction_job: "فاتورة مراجَعة",
  price_review: "مراجعة سعر",
  customer: "زبون",
  customer_invoice: "فاتورة بيع",
  offer: "عرض",
  service_area: "منطقة توصيل",
  store_settings: "إعدادات",
};

const verbs: ReadonlyArray<[suffix: string, verb: string]> = [
  ["_create", "إضافة"],
  ["_update", "تعديل"],
  ["_delete", "حذف"],
  ["_archive", "أرشفة"],
  ["_restore", "استعادة"],
  ["_merge", "دمج"],
  ["_deactivate", "إيقاف"],
  ["_default", "تعيين افتراضي"],
  ["_image", "صورة"],
  ["_remove", "إزالة"],
];

/** A readable Arabic name for an audit action; unknown actions fall back to entity and verb. */
export function auditActionLabel(
  actionType: string,
  entityType: string,
): string {
  const known = actionLabels[actionType];
  if (known) return known;
  const entity = auditEntityLabels[entityType] ?? entityType;
  const verb = verbs.find(([suffix]) => actionType.endsWith(suffix))?.[1];
  return verb ? `${verb} ${entity}` : `${actionType} (${entity})`;
}
