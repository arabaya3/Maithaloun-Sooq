import { z } from "zod";

import { AuthorizationError } from "@/features/admin/domain/admin-actor";

import { CatalogAuthoringError } from "./catalog-authoring-service";

export const authoringMessages: Record<CatalogAuthoringError["code"], string> =
  {
    not_found: "العنصر غير موجود. حدّثي الصفحة.",
    invalid_input: "البيانات غير صالحة.",
    duplicate_sku: "رمز SKU مستخدم لصنف آخر.",
    duplicate_barcode: "الباركود مستخدم لصنف آخر.",
    duplicate_slug: "الرابط مستخدم لمنتج آخر.",
    duplicate_variant: "يوجد صنف فعّال بنفس الاسم والخصائص.",
    duplicate_category: "يوجد قسم بنفس الاسم أو الرمز.",
    category_not_empty: "في القسم منتجات فعّالة. انقليها لقسم آخر قبل الأرشفة.",
    category_has_offers:
      "عرض فعّال مربوط بهذا القسم. عدّلي العرض أو أرشفيه أولاً حتى لا يتوقف دون علمك.",
    category_unavailable: "القسم غير متاح.",
    in_use: "العنصر مستخدم في سجلات سابقة.",
    default_variant: "لا يمكن تطبيق ذلك على الصنف الافتراضي.",
    stock_on_hand: "لهذا الصنف كمية في المخزون.",
    not_publishable: "المنتج غير جاهز للنشر.",
    breaks_published: "المنتج منشور، وهذا التغيير يتركه غير صالح للعرض.",
    stale: "تغيّرت البيانات. حدّثي الصفحة ثم أعيدي المحاولة.",
  };

export function authoringFailure(error: unknown): {
  ok: false;
  message: string;
} {
  if (error instanceof CatalogAuthoringError) {
    if (error.code === "not_publishable" && error.detail === "placeholder") {
      return {
        ok: false,
        message:
          "المنتج بدون صورة حقيقية. فعّلي «النشر بصورة مؤقتة» أو أضيفي صورة أولاً.",
      };
    }
    if (error.code === "category_has_offers" && error.detail) {
      return {
        ok: false,
        message: `العرض «${error.detail}» مربوط بهذا القسم. عدّلي العرض أو أرشفيه أولاً حتى لا يتوقف دون علمك.`,
      };
    }
    if (
      (error.code === "not_publishable" || error.code === "breaks_published") &&
      error.detail
    ) {
      return {
        ok: false,
        message: `${authoringMessages[error.code]} ${error.detail}`,
      };
    }
    return { ok: false, message: authoringMessages[error.code] };
  }
  if (error instanceof AuthorizationError) {
    return { ok: false, message: "هذا الإجراء للمالك فقط." };
  }
  if (error instanceof z.ZodError) {
    return { ok: false, message: "تحقّقي من الحقول المكتوبة." };
  }
  return { ok: false, message: "تعذّر الحفظ. حاولي مرة أخرى." };
}
