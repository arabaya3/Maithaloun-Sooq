import "server-only";

import { revalidatePath } from "next/cache";

import type { AdminActor } from "@/features/admin/domain/admin-actor";
import { AuthorizationError } from "@/features/admin/domain/admin-actor";
import { galleryUploadMessages } from "@/features/admin/domain/gallery-upload-limits";
import {
  GalleryUploadError,
  getProductImageStore,
  prepareGalleryImage,
} from "@/server/storage/product-images";

import { productOptionsService } from "./admin-services";
import { ProductOptionsError } from "./product-options-service";

export type GalleryUploadResult =
  { ok: true } | { ok: false; status: number; message: string };

const optionMessages: Partial<Record<ProductOptionsError["code"], string>> = {
  not_found: "المنتج غير موجود. حدّث الصفحة.",
  gallery_full: "المعرض ممتلئ (8 صور كحد أقصى).",
  too_many: "المعرض ممتلئ (8 صور كحد أقصى).",
};

// The file is published only after validation; if saving the row fails it is removed again.
export async function uploadGalleryImage(
  actor: AdminActor,
  productDomainId: string,
  bytes: Buffer,
  alt: string,
): Promise<GalleryUploadResult> {
  const store = getProductImageStore();
  let stored: { src: string; width: number; height: number };
  try {
    stored = await store.put(await prepareGalleryImage(bytes));
  } catch (error) {
    if (error instanceof GalleryUploadError) {
      return {
        ok: false,
        status: error.code === "too_large" ? 413 : 400,
        message: galleryUploadMessages[error.code],
      };
    }
    throw error;
  }
  try {
    await productOptionsService.addImages(actor, productDomainId, [
      { ...stored, alt: alt.trim().slice(0, 250) || "صورة المنتج" },
    ]);
  } catch (error) {
    await store.remove?.(stored.src);
    if (error instanceof AuthorizationError) {
      return { ok: false, status: 403, message: "هذا الإجراء للمالك فقط." };
    }
    if (error instanceof ProductOptionsError) {
      return {
        ok: false,
        status: error.code === "not_found" ? 404 : 409,
        message: optionMessages[error.code] ?? "تعذّر حفظ الصورة.",
      };
    }
    throw error;
  }
  revalidatePath(`/admin/products/${productDomainId}`);
  revalidatePath("/", "layout");
  return { ok: true };
}
