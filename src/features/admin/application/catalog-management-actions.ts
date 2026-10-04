"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requireTrustedAdminMutation } from "@/features/admin/auth/admin-session";
import { AuthorizationError } from "@/features/admin/domain/admin-actor";
import type { ProductSaveKind } from "@/features/admin/domain/product-save-feedback";
import {
  categoryCodeFrom,
  categoryIconKeys,
} from "@/features/catalog/domain/category";
import { productPublicationValues } from "@/features/catalog/domain/product-constants";

import { catalogAuthoringService } from "./admin-services";
import { CatalogAuthoringError } from "./catalog-authoring-service";

export type CatalogActionResult = { ok: false; message: string } | null;

const productId = z.string().regex(/^[a-z0-9-]{1,80}$/);
const variantId = z.string().regex(/^[a-z0-9-]{1,100}$/);
const categoryCode = z.string().regex(/^[a-z0-9-]{2,40}$/);

const authoringMessages: Record<CatalogAuthoringError["code"], string> = {
  not_found: "العنصر غير موجود. حدّثي الصفحة.",
  invalid_input: "البيانات غير صالحة.",
  duplicate_sku: "رمز SKU مستخدم لصنف آخر.",
  duplicate_barcode: "الباركود مستخدم لصنف آخر.",
  duplicate_slug: "الرابط مستخدم لمنتج آخر.",
  duplicate_variant: "يوجد صنف فعّال بنفس الاسم والخصائص.",
  duplicate_category: "يوجد قسم بنفس الاسم أو الرمز.",
  category_not_empty: "في القسم منتجات فعّالة. انقليها لقسم آخر قبل الأرشفة.",
  category_unavailable: "القسم غير متاح.",
  in_use: "العنصر مستخدم في سجلات سابقة.",
  default_variant: "لا يمكن تطبيق ذلك على الصنف الافتراضي.",
  stock_on_hand: "لهذا الصنف كمية في المخزون.",
  not_publishable: "المنتج غير جاهز للنشر.",
  stale: "تغيّرت البيانات. حدّثي الصفحة ثم أعيدي المحاولة.",
};

function authoringFailure(error: unknown): { ok: false; message: string } {
  if (error instanceof CatalogAuthoringError) {
    if (error.code === "not_publishable" && error.detail === "placeholder") {
      return {
        ok: false,
        message:
          "المنتج بدون صورة حقيقية. فعّلي «النشر بصورة مؤقتة» أو أضيفي صورة أولاً.",
      };
    }
    if (error.code === "not_publishable" && error.detail) {
      return {
        ok: false,
        message: `${authoringMessages.not_publishable} ${error.detail}`,
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

function productSaved(domainId: string, saved: ProductSaveKind): never {
  revalidatePath("/");
  revalidatePath("/admin/products");
  revalidatePath(`/admin/products/${domainId}`);
  redirect(`/admin/products/${domainId}?saved=${saved}&at=${Date.now()}`);
}

function text(value: FormDataEntryValue | null): string {
  return String(value ?? "").trim();
}

function identifier(value: FormDataEntryValue | null): string | null {
  return text(value) || null;
}

export async function restoreVariantAction(
  _state: CatalogActionResult,
  formData: FormData,
): Promise<CatalogActionResult> {
  const actor = await requireTrustedAdminMutation();
  const product = productId.safeParse(formData.get("productDomainId"));
  const variant = variantId.safeParse(formData.get("variantDomainId"));
  if (!product.success || !variant.success) {
    return { ok: false, message: authoringMessages.invalid_input };
  }
  try {
    await catalogAuthoringService.restoreVariant(actor, variant.data);
  } catch (error) {
    return authoringFailure(error);
  }
  productSaved(product.data, "variant_restored");
}

export async function updateVariantIdentifiersAction(
  _state: CatalogActionResult,
  formData: FormData,
): Promise<CatalogActionResult> {
  const actor = await requireTrustedAdminMutation();
  const product = productId.safeParse(formData.get("productDomainId"));
  const variant = variantId.safeParse(formData.get("variantDomainId"));
  if (!product.success || !variant.success) {
    return { ok: false, message: authoringMessages.invalid_input };
  }
  const sku = identifier(formData.get("sku"));
  const barcode = identifier(formData.get("barcode"));
  const format = /^[A-Za-z0-9._-]{3,64}$/;
  if ((sku && !format.test(sku)) || (barcode && !format.test(barcode))) {
    return {
      ok: false,
      message:
        "SKU والباركود من 3 إلى 64 خانة: أحرف لاتينية وأرقام و . _ - فقط.",
    };
  }
  try {
    await catalogAuthoringService.updateVariant(actor, variant.data, {
      sku,
      barcode,
    });
  } catch (error) {
    return authoringFailure(error);
  }
  productSaved(product.data, "variant");
}

export async function setPublicationAction(
  _state: CatalogActionResult,
  formData: FormData,
): Promise<CatalogActionResult> {
  const actor = await requireTrustedAdminMutation();
  const product = productId.safeParse(formData.get("domainId"));
  const publication = z
    .enum(productPublicationValues)
    .safeParse(formData.get("publication"));
  if (!product.success || !publication.success) {
    return { ok: false, message: authoringMessages.invalid_input };
  }
  try {
    await catalogAuthoringService.setPublication(actor, {
      domainId: product.data,
      publication: publication.data,
      acceptPlaceholder: formData.get("acceptPlaceholder") === "on",
    });
  } catch (error) {
    return authoringFailure(error);
  }
  productSaved(product.data, "publication");
}

function categoriesSaved(saved: string): never {
  revalidatePath("/", "layout");
  revalidatePath("/admin/categories");
  redirect(`/admin/categories?saved=${saved}`);
}

const iconSchema = z.enum(categoryIconKeys);

export async function createCategoryAction(
  _state: CatalogActionResult,
  formData: FormData,
): Promise<CatalogActionResult> {
  const actor = await requireTrustedAdminMutation();
  const nameAr = text(formData.get("nameAr"));
  const icon = iconSchema.safeParse(formData.get("icon"));
  if (nameAr.length < 2 || nameAr.length > 80 || !icon.success) {
    return {
      ok: false,
      message: "اكتبي اسم قسم من 2 إلى 80 حرفاً واختاري أيقونة.",
    };
  }
  try {
    const taken = new Set(
      (await catalogAuthoringService.listCategories(true)).map(
        (row) => row.code,
      ),
    );
    const typed = text(formData.get("code")).toLowerCase();
    await catalogAuthoringService.createCategory(actor, {
      code: typed || categoryCodeFrom(nameAr, taken),
      nameAr,
      description: text(formData.get("description")) || null,
      icon: icon.data,
      visible: formData.get("visible") === "on",
    });
  } catch (error) {
    return authoringFailure(error);
  }
  categoriesSaved("created");
}

export async function updateCategoryAction(
  _state: CatalogActionResult,
  formData: FormData,
): Promise<CatalogActionResult> {
  const actor = await requireTrustedAdminMutation();
  const code = categoryCode.safeParse(formData.get("code"));
  const icon = iconSchema.safeParse(formData.get("icon"));
  const nameAr = text(formData.get("nameAr"));
  const sortOrder = Number(formData.get("sortOrder"));
  if (
    !code.success ||
    !icon.success ||
    nameAr.length < 2 ||
    nameAr.length > 80 ||
    !Number.isInteger(sortOrder) ||
    sortOrder < 0 ||
    sortOrder > 10_000
  ) {
    return { ok: false, message: authoringMessages.invalid_input };
  }
  try {
    await catalogAuthoringService.updateCategory(actor, code.data, {
      nameAr,
      description: text(formData.get("description")) || null,
      icon: icon.data,
      visible: formData.get("visible") === "on",
      sortOrder,
    });
  } catch (error) {
    return authoringFailure(error);
  }
  categoriesSaved("updated");
}

export async function setCategoryArchivedAction(
  _state: CatalogActionResult,
  formData: FormData,
): Promise<CatalogActionResult> {
  const actor = await requireTrustedAdminMutation();
  const code = categoryCode.safeParse(formData.get("code"));
  if (!code.success)
    return { ok: false, message: authoringMessages.invalid_input };
  const archive = formData.get("archive") === "1";
  try {
    if (archive)
      await catalogAuthoringService.archiveCategory(actor, code.data);
    else await catalogAuthoringService.restoreCategory(actor, code.data);
  } catch (error) {
    return authoringFailure(error);
  }
  categoriesSaved(archive ? "archived" : "restored");
}
