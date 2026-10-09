"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireTrustedAdminMutation } from "@/features/admin/auth/admin-session";
import { newProductId } from "@/features/admin/domain/product-identity";
import { parseIlsToAgorot } from "@/shared/lib/parse-ils";

import { mapProductAdminError } from "./admin-action-errors";
import { authoringFailure } from "./catalog-authoring-errors";
import { mapInventoryError } from "@/features/inventory/application/inventory-action-errors";

import {
  adminCatalogService,
  catalogAuthoringService,
  inventoryService,
} from "./admin-services";

export type WizardField = "nameAr" | "categoryId" | "priceIls" | "latinName";

export type WizardDraftState = {
  ok: false;
  message: string;
  field?: WizardField;
} | null;

const text = (value: FormDataEntryValue | null) =>
  typeof value === "string" ? value.trim() : "";

/** Step 1 of the product wizard: saves a draft the owner can leave and resume. */
export async function createWizardDraftAction(
  _state: WizardDraftState,
  formData: FormData,
): Promise<WizardDraftState> {
  const actor = await requireTrustedAdminMutation();
  const nameAr = text(formData.get("nameAr"));
  if (nameAr.length < 2 || nameAr.length > 160) {
    return {
      ok: false,
      field: "nameAr",
      message: "اكتبي اسم المنتج بالعربية (حرفان على الأقل).",
    };
  }
  const categoryId = text(formData.get("categoryId"));
  const categories = await catalogAuthoringService.listCategories();
  if (!categories.some((category) => category.code === categoryId)) {
    return { ok: false, field: "categoryId", message: "اختاري القسم." };
  }
  const priceAgorot = parseIlsToAgorot(text(formData.get("priceIls")));
  if (priceAgorot === null || priceAgorot <= 0) {
    return {
      ok: false,
      field: "priceIls",
      message: "اكتبي سعر البيع بالشيكل، مثل 12 أو 12.50.",
    };
  }
  const latinName = text(formData.get("latinName"));
  if (latinName.length > 120) {
    return {
      ok: false,
      field: "latinName",
      message: "الاسم اللاتيني 120 حرفاً على الأكثر.",
    };
  }
  const domainId = newProductId(latinName, randomUUID());
  try {
    await adminCatalogService.create(actor, {
      domainId,
      slug: domainId,
      nameAr,
      latinName: latinName || undefined,
      priceAgorot,
      categoryId: categoryId as never,
      availability: "unavailable",
      sortOrder: 100,
      description: text(formData.get("description")) || undefined,
      usageNotes: undefined,
      unit: undefined,
      detailsStatus: "placeholder",
      placeholderVariant: "general-cleaner",
    });
  } catch (error) {
    return { ok: false, message: mapProductAdminError(error) };
  }
  revalidatePath("/admin/products");
  redirect(`/admin/products/new?product=${domainId}&step=2`);
}

export type VariantCardResult = { ok: true } | { ok: false; message: string };

const VARIANT_ID = /^[a-z0-9-]{1,100}$/;
const PRODUCT_ID = /^[a-z0-9-]{1,80}$/;
const IDENTIFIER = /^[A-Za-z0-9._-]{3,64}$/;

/** A whole number of pieces, or null when left empty. */
function pieces(value: string): number | null | "invalid" {
  const text = value.trim();
  if (!text) return null;
  if (!/^\d{1,6}$/.test(text)) return "invalid";
  return Number(text);
}

/**
 * Step 4: one exact variant's price, identifiers, availability, default flag, stock and threshold.
 * Each part goes through its own service, so a refusal names the part that failed.
 */
export async function saveVariantCardAction(input: {
  productDomainId: string;
  variantId: string;
  priceIls: string;
  sku: string;
  barcode: string;
  available: boolean;
  isDefault: boolean;
  stockPieces: string;
  unitCostIls: string;
  thresholdPieces: string;
  tracked: boolean;
  idempotencyKey: string;
}): Promise<VariantCardResult> {
  const actor = await requireTrustedAdminMutation();
  if (
    !PRODUCT_ID.test(input.productDomainId) ||
    !VARIANT_ID.test(input.variantId)
  ) {
    return { ok: false, message: "الصنف غير موجود. حدّثي الصفحة." };
  }
  const priceAgorot = parseIlsToAgorot(input.priceIls);
  if (priceAgorot === null || priceAgorot <= 0) {
    return { ok: false, message: "اكتبي سعر هذا الصنف بالشيكل." };
  }
  const sku = input.sku.trim();
  const barcode = input.barcode.trim();
  if (
    (sku && !IDENTIFIER.test(sku)) ||
    (barcode && !IDENTIFIER.test(barcode))
  ) {
    return {
      ok: false,
      message: "رمز SKU والباركود أحرف لاتينية وأرقام فقط (3 إلى 64).",
    };
  }
  const stock = pieces(input.stockPieces);
  const threshold = pieces(input.thresholdPieces);
  if (stock === "invalid" || threshold === "invalid") {
    return { ok: false, message: "الكمية وحد التنبيه أعداد صحيحة من القطع." };
  }
  // Opening stock needs its cost, or profit on its sales could never be calculated.
  const opening = stock !== null && stock > 0 && !input.tracked;
  const costAgorot = opening ? parseIlsToAgorot(input.unitCostIls) : null;
  if (opening && (costAgorot === null || costAgorot <= 0)) {
    return { ok: false, message: "اكتبي تكلفة القطعة للكمية الافتتاحية." };
  }

  try {
    await catalogAuthoringService.updateVariant(actor, input.variantId, {
      priceAgorot,
      sku: sku || null,
      barcode: barcode || null,
      availability: input.available ? "available" : "unavailable",
    });
    if (input.isDefault)
      await catalogAuthoringService.setDefaultVariant(actor, input.variantId);
  } catch (error) {
    return authoringFailure(error);
  }
  try {
    if (stock !== null && (opening || input.tracked)) {
      await inventoryService.adjust(actor, {
        idempotencyKey: input.idempotencyKey,
        variantId: input.variantId,
        reason: opening ? "opening_balance" : "correction",
        quantityMilli: stock * 1_000,
        ...(opening ? { unitCostAgorot: costAgorot! } : {}),
        note: opening
          ? "رصيد افتتاحي من إضافة المنتج"
          : "تصحيح من صفحة الأصناف",
      });
    }
    if (input.thresholdPieces.trim() !== "" && (input.tracked || opening)) {
      await inventoryService.setReorderThreshold(actor, {
        variantId: input.variantId,
        thresholdMilli: threshold === null ? null : threshold * 1_000,
      });
    }
  } catch (error) {
    return {
      ok: false,
      message: `حُفظ السعر والرموز، لكن لم يُحفظ المخزون: ${mapInventoryError(error)}`,
    };
  }
  revalidatePath(`/admin/products/${input.productDomainId}`);
  revalidatePath("/", "layout");
  return { ok: true };
}

export type PublishChoice =
  "draft" | "published" | "published_unavailable" | "hidden";

/** Step 5: the server repeats every publishing check; the choice only states the owner's intent. */
export async function publishProductAction(input: {
  productDomainId: string;
  choice: PublishChoice;
  acceptPlaceholder: boolean;
}): Promise<VariantCardResult> {
  const actor = await requireTrustedAdminMutation();
  if (!PRODUCT_ID.test(input.productDomainId))
    return { ok: false, message: "المنتج غير موجود. حدّثي الصفحة." };
  const choices: Record<
    PublishChoice,
    {
      publication: "draft" | "published" | "hidden";
      availability?: "available" | "unavailable";
    }
  > = {
    draft: { publication: "draft" },
    published: { publication: "published", availability: "available" },
    published_unavailable: {
      publication: "published",
      availability: "unavailable",
    },
    hidden: { publication: "hidden" },
  };
  const target = choices[input.choice];
  if (!target) return { ok: false, message: "اختاري حالة المنتج." };
  try {
    await catalogAuthoringService.setPublication(actor, {
      domainId: input.productDomainId,
      ...target,
      acceptPlaceholder: input.acceptPlaceholder,
    });
    // Availability now comes from every variant, so closing the product closes each one explicitly.
    if (input.choice === "published_unavailable") {
      const product = await adminCatalogService.getByDomainId(
        actor,
        input.productDomainId,
      );
      for (const variant of product?.variants ?? []) {
        if (variant.availability === "available")
          await catalogAuthoringService.updateVariant(actor, variant.id, {
            availability: "unavailable",
          });
      }
    }
  } catch (error) {
    return authoringFailure(error);
  }
  revalidatePath(`/admin/products/${input.productDomainId}`);
  revalidatePath("/admin/products");
  revalidatePath("/", "layout");
  return { ok: true };
}
