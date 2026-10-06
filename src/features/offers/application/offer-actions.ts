"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { offerService } from "@/features/admin/application/admin-services";
import { requireTrustedAdminMutation } from "@/features/admin/auth/admin-session";
import { AuthorizationError } from "@/features/admin/domain/admin-actor";
import { readOfferForm } from "./offer-form";
import { OfferError } from "./offer-service";

export type OfferPreviewState =
  | {
      ok: true;
      rows: Array<{
        variantId: string;
        label: string;
        listPriceAgorot: number;
        finalPriceAgorot: number | null;
        /** Cost only reaches the owner, who is the only one who can open offers. */
        avgCostAgorot: number | null;
      }>;
      conflicts: Array<{ nameAr: string; variants: string[] }>;
    }
  | { ok: false; message: string }
  | null;

export type OfferActionResult = { ok: false; message: string } | null;

const offerMessages: Record<OfferError["code"], string> = {
  not_found: "العرض غير موجود. حدّثي الصفحة.",
  invalid_input: "بيانات العرض غير صالحة.",
  invalid_price:
    "العرض لا يخفّض سعر أحد الأصناف أو يجعله صفراً. راجعي القيمة في المعاينة.",
  conflict:
    "يتعارض مع عرض مفعّل آخر على نفس الأصناف في نفس الفترة. غيّري المدة أو الأصناف.",
  in_use: "العرض استُخدم في طلبات، لذلك لا يُحذف. يمكنك أرشفته.",
  empty_target: "اختاري قسماً أو منتجاً واحداً على الأقل.",
  stale: "تغيّر العرض منذ فتحتِه. حدّثي الصفحة ثم أعيدي التعديل.",
};

function failure(error: unknown): { ok: false; message: string } {
  if (error instanceof OfferError) {
    if (error.code === "conflict" && error.detail) {
      return {
        ok: false,
        message: `يتعارض مع العرض المفعّل «${error.detail}» على نفس الأصناف في نفس الفترة.`,
      };
    }
    if (error.code === "invalid_price" && error.detail) {
      return {
        ok: false,
        message: `العرض لا يخفّض سعر «${error.detail}» أو يجعله صفراً.`,
      };
    }
    return { ok: false, message: offerMessages[error.code] };
  }
  if (error instanceof AuthorizationError) {
    return { ok: false, message: "العروض للمالك فقط." };
  }
  if (error instanceof z.ZodError) {
    return { ok: false, message: offerMessages.invalid_input };
  }
  return { ok: false, message: "تعذّر الحفظ. حاولي مرة أخرى." };
}

const text = (value: FormDataEntryValue | null) =>
  typeof value === "string" ? value.trim() : "";

export async function previewOfferAction(
  _state: OfferPreviewState,
  formData: FormData,
): Promise<OfferPreviewState> {
  await requireTrustedAdminMutation();
  const read = readOfferForm(formData);
  if ("message" in read) return { ok: false, message: read.message };
  const offerId = text(formData.get("offerId"));
  try {
    const [rows, conflicts] = await Promise.all([
      offerService.preview(read.input),
      offerService.conflicts(
        read.input,
        z.uuid().safeParse(offerId).success ? offerId : undefined,
      ),
    ]);
    if (!rows.length) return { ok: false, message: offerMessages.empty_target };
    return {
      ok: true,
      rows,
      conflicts: conflicts.map(({ nameAr, variants }) => ({
        nameAr,
        variants,
      })),
    };
  } catch (error) {
    return failure(error);
  }
}

function offersSaved(path: string): never {
  revalidatePath("/", "layout");
  revalidatePath("/admin/offers");
  redirect(path);
}

export async function saveOfferAction(
  _state: OfferActionResult,
  formData: FormData,
): Promise<OfferActionResult> {
  const actor = await requireTrustedAdminMutation();
  const read = readOfferForm(formData);
  if ("message" in read) return { ok: false, message: read.message };
  const offerId = text(formData.get("offerId"));
  let id = offerId;
  try {
    if (offerId) {
      if (!z.uuid().safeParse(offerId).success)
        return { ok: false, message: offerMessages.not_found };
      await offerService.update(
        actor,
        offerId,
        read.input,
        text(formData.get("version")) || undefined,
      );
    } else {
      id = (await offerService.create(actor, read.input)).id;
    }
  } catch (error) {
    return failure(error);
  }
  offersSaved(`/admin/offers/${id}?saved=${offerId ? "updated" : "created"}`);
}

export async function archiveOfferAction(
  _state: OfferActionResult,
  formData: FormData,
): Promise<OfferActionResult> {
  const actor = await requireTrustedAdminMutation();
  const offerId = z.uuid().safeParse(formData.get("offerId"));
  if (!offerId.success) return { ok: false, message: offerMessages.not_found };
  const archive = formData.get("archive") === "1";
  try {
    await offerService.setArchived(actor, offerId.data, archive);
  } catch (error) {
    return failure(error);
  }
  offersSaved(
    `/admin/offers/${offerId.data}?saved=${archive ? "archived" : "restored"}`,
  );
}

export async function deleteOfferAction(
  _state: OfferActionResult,
  formData: FormData,
): Promise<OfferActionResult> {
  const actor = await requireTrustedAdminMutation();
  const offerId = z.uuid().safeParse(formData.get("offerId"));
  if (!offerId.success) return { ok: false, message: offerMessages.not_found };
  try {
    await offerService.deleteUnused(actor, offerId.data);
  } catch (error) {
    return failure(error);
  }
  offersSaved("/admin/offers?saved=deleted");
}
