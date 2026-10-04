export const productSaveMessages = {
  product: "تم حفظ تغييرات المنتج.",
  created: "تم إنشاء المنتج. أكملي التفاصيل ثم انشريه.",
  variant: "تم حفظ الصنف.",
  variant_off: "تم تعطيل الصنف.",
  variant_restored: "تمت استعادة الصنف المؤرشف.",
  spec: "تم حفظ المواصفة.",
  spec_removed: "تم حذف المواصفة.",
  publication: "تم تحديث حالة النشر.",
} as const;

export type ProductSaveKind = keyof typeof productSaveMessages;

export function productSaveMessage(value: unknown): string | null {
  return typeof value === "string" && Object.hasOwn(productSaveMessages, value)
    ? productSaveMessages[value as ProductSaveKind]
    : null;
}
