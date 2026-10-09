"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireTrustedAdminMutation } from "@/features/admin/auth/admin-session";
import { newProductId } from "@/features/admin/domain/product-identity";
import { parseIlsToAgorot } from "@/shared/lib/parse-ils";

import { mapProductAdminError } from "./admin-action-errors";
import { adminCatalogService, catalogAuthoringService } from "./admin-services";

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
