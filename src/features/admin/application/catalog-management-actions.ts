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

import {
  adminCatalogService,
  catalogAuthoringService,
  productMaintenanceService,
} from "./admin-services";
import { CatalogAuthoringError } from "./catalog-authoring-service";
import { ProductMaintenanceError } from "./product-maintenance-service";

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
  breaks_published: "المنتج منشور، وهذا التغيير يتركه غير صالح للعرض.",
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

export type BulkPublicationResult =
  | { ok: false; message: string }
  | {
      ok: true;
      changed: number;
      failed: Array<{ domainId: string; message: string }>;
    }
  | null;

const BULK_LIMIT = 100;

/**
 * Changes publication product by product, each in its own transaction with the full publish check,
 * so one product that is not ready never blocks or rolls back the others.
 */
export async function bulkPublicationAction(
  _state: BulkPublicationResult,
  formData: FormData,
): Promise<BulkPublicationResult> {
  const actor = await requireTrustedAdminMutation();
  const ids = z
    .array(productId)
    .min(1)
    .max(BULK_LIMIT)
    .safeParse([...new Set(formData.getAll("domainId").map(String))]);
  const publication = z
    .enum(productPublicationValues)
    .safeParse(formData.get("publication"));
  if (!ids.success || !publication.success) {
    return {
      ok: false,
      message: "اختاري منتجاً واحداً على الأقل وحالة النشر.",
    };
  }
  let changed = 0;
  const failed: Array<{ domainId: string; message: string }> = [];
  for (const domainId of ids.data) {
    try {
      await catalogAuthoringService.setPublication(actor, {
        domainId,
        publication: publication.data,
        acceptPlaceholder: false,
      });
      changed += 1;
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return { ok: false, message: "هذا الإجراء للمالك فقط." };
      }
      failed.push({ domainId, message: authoringFailure(error).message });
    }
  }
  if (changed) {
    revalidatePath("/");
    revalidatePath("/admin/products");
  }
  return { ok: true, changed, failed };
}

export async function restoreProductAction(
  _state: CatalogActionResult,
  formData: FormData,
): Promise<CatalogActionResult> {
  const actor = await requireTrustedAdminMutation();
  const product = productId.safeParse(formData.get("domainId"));
  if (!product.success) {
    return { ok: false, message: authoringMessages.invalid_input };
  }
  try {
    await catalogAuthoringService.restoreProduct(actor, product.data);
  } catch (error) {
    return authoringFailure(error);
  }
  productSaved(product.data, "restored");
}

const maintenanceMessages: Record<ProductMaintenanceError["code"], string> = {
  not_found: "المنتج غير موجود. حدّثي الصفحة.",
  invalid_input: "اكتبي سبباً واضحاً من حرفين على الأقل.",
  in_use: "المنتج مرتبط بسجلات، فلا يمكن حذفه نهائياً. أرشفيه بدلاً من ذلك.",
  archived: "المنتج مؤرشف.",
  reserved_stock: "للمنتج كمية محجوزة لطلبات مفتوحة.",
  same_product: "لا يمكن دمج المنتج مع نفسه.",
};

function maintenanceFailure(error: unknown): { ok: false; message: string } {
  if (error instanceof ProductMaintenanceError) {
    return { ok: false, message: maintenanceMessages[error.code] };
  }
  return authoringFailure(error);
}

export async function archiveProductAction(
  _state: CatalogActionResult,
  formData: FormData,
): Promise<CatalogActionResult> {
  const actor = await requireTrustedAdminMutation();
  const product = productId.safeParse(formData.get("domainId"));
  if (!product.success) {
    return { ok: false, message: authoringMessages.invalid_input };
  }
  try {
    await productMaintenanceService.archive(actor, {
      domainId: product.data,
      reason: text(formData.get("reason")),
    });
  } catch (error) {
    return maintenanceFailure(error);
  }
  productSaved(product.data, "archived");
}

/**
 * Permanent delete: the server scans references again and requires the product's exact name, so a
 * stale page or a slip of the finger can never remove a product that has history.
 */
export async function deleteProductAction(
  _state: CatalogActionResult,
  formData: FormData,
): Promise<CatalogActionResult> {
  const actor = await requireTrustedAdminMutation();
  const product = productId.safeParse(formData.get("domainId"));
  if (!product.success) {
    return { ok: false, message: authoringMessages.invalid_input };
  }
  let name: string;
  try {
    const references = await productMaintenanceService.references(
      actor,
      product.data,
    );
    const current = await adminCatalogService.getByDomainId(
      actor,
      product.data,
    );
    if (!references || !current) {
      return { ok: false, message: maintenanceMessages.not_found };
    }
    if (Object.values(references).some((count) => count > 0)) {
      return { ok: false, message: maintenanceMessages.in_use };
    }
    name = current.nameAr;
    if (text(formData.get("confirmName")) !== name.trim()) {
      return {
        ok: false,
        message: "اكتبي اسم المنتج كما هو تماماً لتأكيد الحذف النهائي.",
      };
    }
    const result = await productMaintenanceService.deleteUnreferenced(
      actor,
      product.data,
    );
    if (!result.deleted) {
      return { ok: false, message: maintenanceMessages.not_found };
    }
  } catch (error) {
    return maintenanceFailure(error);
  }
  revalidatePath("/");
  revalidatePath("/admin/products");
  redirect(`/admin/products?deleted=${encodeURIComponent(name)}`);
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
