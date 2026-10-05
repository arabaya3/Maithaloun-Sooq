"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireTrustedAdminMutation } from "@/features/admin/auth/admin-session";
import { AuthorizationError } from "@/features/admin/domain/admin-actor";
import { parseImageTarget } from "@/features/admin/domain/image-target";
import { optionKinds } from "@/features/catalog/domain/product-options";
import { parseMoneyInput } from "@/shared/lib/money-input";
import { getProductImageStore } from "@/server/storage/product-images";

import { CatalogAuthoringError } from "./catalog-authoring-service";
import { ProductOptionsError } from "./product-options-service";
import {
  catalogAuthoringService,
  productOptionsService,
} from "./admin-services";

export type MediaActionResult = { ok: true } | { ok: false; message: string };

const messages: Record<ProductOptionsError["code"], string> = {
  not_found: "العنصر غير موجود. حدّث الصفحة.",
  invalid_input: "البيانات غير صالحة.",
  duplicate_option: "يوجد خيار بنفس الاسم لهذا المنتج.",
  duplicate_value: "هذه القيمة موجودة في الخيار نفسه.",
  duplicate_combination: "يوجد صنف فعّال بنفس الاختيارات.",
  incomplete_combination: "اختر قيمة لكل خيار.",
  in_use: "مستخدم في أصناف حالية، لذلك لا يمكن إزالته الآن.",
  archived: "هذا العنصر مؤرشف.",
  too_many: "وصلت للحد الأقصى المسموح.",
  gallery_full: "المعرض ممتلئ (8 صور كحد أقصى).",
  primary_required: "يجب أن تبقى صورة رئيسية.",
  default_variant: "لا يمكن تطبيق ذلك على الصنف الافتراضي.",
  has_images:
    "صور مرتبطة بهذه القيمة. انقل الصور إلى قيمة أخرى أو اجعلها صورة عامة أولاً.",
  primary_must_be_shared: "الصورة الرئيسية يجب أن تكون صورة عامة للمنتج.",
};

async function run(
  productDomainId: string,
  action: () => Promise<unknown>,
): Promise<MediaActionResult> {
  try {
    await action();
  } catch (error) {
    if (error instanceof ProductOptionsError) {
      return { ok: false, message: messages[error.code] };
    }
    if (
      error instanceof CatalogAuthoringError &&
      error.code === "breaks_published"
    ) {
      return {
        ok: false,
        message:
          `المنتج منشور، وهذا التغيير يتركه غير صالح للعرض. ${error.detail ?? ""}`.trim(),
      };
    }
    if (error instanceof CatalogAuthoringError) {
      return {
        ok: false,
        message:
          error.code === "not_found"
            ? "الصنف غير موجود أو مؤرشف."
            : "تعذّر الحفظ. حدّث الصفحة ثم حاول مرة أخرى.",
      };
    }
    if (error instanceof AuthorizationError) {
      return { ok: false, message: "هذا الإجراء للمالك فقط." };
    }
    if (error instanceof z.ZodError) {
      return { ok: false, message: "تحقق من الحقول المكتوبة." };
    }
    return { ok: false, message: "تعذّر الحفظ. حاول مرة أخرى." };
  }
  revalidatePath(`/admin/products/${productDomainId}`);
  revalidatePath("/", "layout");
  return { ok: true };
}

const productId = z.string().regex(/^[a-z0-9-]{1,80}$/);
const variantId = z.string().regex(/^[a-z0-9-]{1,100}$/);
const uuid = z.uuid();

export async function galleryImageAction(input: {
  productDomainId: string;
  imageId: string;
  action: "primary" | "archive" | "restore" | "delete" | "scope" | "alt";
  target?: string;
  alt?: string;
}): Promise<MediaActionResult> {
  const actor = await requireTrustedAdminMutation();
  const domainId = productId.parse(input.productDomainId);
  const imageId = uuid.parse(input.imageId);
  return run(domainId, async () => {
    if (input.action === "primary")
      await productOptionsService.setPrimaryImage(actor, imageId);
    if (input.action === "archive")
      await productOptionsService.setImageArchived(actor, imageId, true);
    if (input.action === "restore")
      await productOptionsService.setImageArchived(actor, imageId, false);
    if (input.action === "alt")
      await productOptionsService.updateImageAlt(
        actor,
        imageId,
        input.alt ?? "",
      );
    if (input.action === "scope") {
      const target = parseImageTarget(input.target);
      if (!target) throw new ProductOptionsError("invalid_input");
      await productOptionsService.setImageScope(actor, imageId, target);
    }
    if (input.action === "delete") {
      const removed = await productOptionsService.deleteImage(actor, imageId);
      if (!removed.fileStillUsed)
        await getProductImageStore().remove?.(removed.src);
    }
  });
}

export async function valueSharedImageAction(input: {
  productDomainId: string;
  valueId: string;
  usesSharedImage: boolean;
}): Promise<MediaActionResult> {
  const actor = await requireTrustedAdminMutation();
  const domainId = productId.parse(input.productDomainId);
  const valueId = uuid.parse(input.valueId);
  return run(domainId, () =>
    productOptionsService.setValueSharedImage(
      actor,
      valueId,
      z.boolean().parse(input.usesSharedImage),
    ),
  );
}

export async function reorderGalleryAction(
  productDomainId: string,
  imageIds: string[],
): Promise<MediaActionResult> {
  const actor = await requireTrustedAdminMutation();
  const domainId = productId.parse(productDomainId);
  return run(domainId, () =>
    productOptionsService.reorderImages(
      actor,
      domainId,
      z.array(uuid).max(8).parse(imageIds),
    ),
  );
}

export async function createOptionAction(input: {
  productDomainId: string;
  nameAr: string;
  kind: string;
  values: string;
}): Promise<MediaActionResult> {
  const actor = await requireTrustedAdminMutation();
  const domainId = productId.parse(input.productDomainId);
  const values = input.values
    .split(/[،,\n]/)
    .map((value) => value.trim())
    .filter(Boolean);
  return run(domainId, () =>
    productOptionsService.createOption(actor, domainId, {
      nameAr: input.nameAr,
      kind: z.enum(optionKinds).parse(input.kind),
      values,
    }),
  );
}

export async function optionAction(input: {
  productDomainId: string;
  optionId: string;
  action:
    | "rename"
    | "kind"
    | "archive"
    | "restore"
    | "delete"
    | "addValue"
    | "up"
    | "down";
  text?: string;
  orderedIds?: string[];
}): Promise<MediaActionResult> {
  const actor = await requireTrustedAdminMutation();
  const domainId = productId.parse(input.productDomainId);
  const optionId = uuid.parse(input.optionId);
  return run(domainId, async () => {
    if (input.action === "rename")
      await productOptionsService.updateOption(actor, optionId, {
        nameAr: input.text ?? "",
      });
    if (input.action === "kind")
      await productOptionsService.updateOption(actor, optionId, {
        kind: z.enum(optionKinds).parse(input.text),
      });
    if (input.action === "archive")
      await productOptionsService.setOptionArchived(actor, optionId, true);
    if (input.action === "restore")
      await productOptionsService.setOptionArchived(actor, optionId, false);
    if (input.action === "delete")
      await productOptionsService.deleteOption(actor, optionId);
    if (input.action === "addValue")
      await productOptionsService.addValue(actor, optionId, input.text ?? "");
    if (input.action === "up" || input.action === "down") {
      await productOptionsService.reorderOptions(
        actor,
        domainId,
        z.array(uuid).max(10).parse(input.orderedIds),
      );
    }
  });
}

export async function optionValueAction(input: {
  productDomainId: string;
  valueId: string;
  action: "rename" | "archive" | "restore" | "delete" | "reorder";
  text?: string;
  optionId?: string;
  orderedIds?: string[];
}): Promise<MediaActionResult> {
  const actor = await requireTrustedAdminMutation();
  const domainId = productId.parse(input.productDomainId);
  const valueId = uuid.parse(input.valueId);
  return run(domainId, async () => {
    if (input.action === "rename")
      await productOptionsService.updateValue(actor, valueId, input.text ?? "");
    if (input.action === "archive")
      await productOptionsService.setValueArchived(actor, valueId, true);
    if (input.action === "restore")
      await productOptionsService.setValueArchived(actor, valueId, false);
    if (input.action === "delete")
      await productOptionsService.deleteValue(actor, valueId);
    if (input.action === "reorder") {
      await productOptionsService.reorderValues(
        actor,
        uuid.parse(input.optionId),
        z.array(uuid).max(30).parse(input.orderedIds),
      );
    }
  });
}

export async function defaultVariantAction(input: {
  productDomainId: string;
  variantDomainId: string;
}): Promise<MediaActionResult> {
  const actor = await requireTrustedAdminMutation();
  const domainId = productId.parse(input.productDomainId);
  return run(domainId, () =>
    catalogAuthoringService.setDefaultVariant(
      actor,
      z.string().trim().min(1).max(100).parse(input.variantDomainId),
    ),
  );
}

export async function variantOptionsAction(input: {
  productDomainId: string;
  variantDomainId: string;
  selection: Record<string, string>;
  packCount: string;
}): Promise<MediaActionResult> {
  const actor = await requireTrustedAdminMutation();
  const domainId = productId.parse(input.productDomainId);
  const pack = input.packCount.trim() ? Number(input.packCount) : null;
  if (
    pack !== null &&
    !(Number.isInteger(pack) && pack >= 1 && pack <= 1_000)
  ) {
    return {
      ok: false,
      message: "عدد القطع في العبوة رقم صحيح من 1 إلى 1000.",
    };
  }
  return run(domainId, () =>
    productOptionsService.setVariantSelection(
      actor,
      variantId.parse(input.variantDomainId),
      {
        selection: z.record(uuid, uuid).parse(input.selection),
        packCount: pack,
      },
    ),
  );
}

export async function generateMissingVariantsAction(input: {
  productDomainId: string;
  combinations: Array<Record<string, string>>;
  priceIls: string;
}): Promise<MediaActionResult> {
  const actor = await requireTrustedAdminMutation();
  const domainId = productId.parse(input.productDomainId);
  const price = parseMoneyInput(input.priceIls);
  if (!price.ok)
    return { ok: false, message: "اكتب سعر الأصناف الجديدة، مثلاً 15 شيكل." };
  return run(domainId, () =>
    productOptionsService.generateVariants(
      actor,
      domainId,
      z
        .array(z.record(uuid, uuid))
        .min(1)
        .max(60)
        .parse(input.combinations)
        .map((selection) => ({ selection, priceAgorot: price.agorot })),
      crypto.randomUUID(),
    ),
  );
}
