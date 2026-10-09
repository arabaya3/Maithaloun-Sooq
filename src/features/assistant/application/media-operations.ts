import "server-only";

import sharp from "sharp";
import { z } from "zod";

import {
  ProductOptionsError,
  productSetSchema,
  type ProductMatrix,
  type ProductOptionsService,
  type ProductSetInput,
} from "@/features/admin/application/product-options-service";
import type { AdminActor } from "@/features/admin/domain/admin-actor";
import { can } from "@/features/admin/domain/permissions";
import type { Product } from "@/features/catalog/domain/product";
import { MAX_PRODUCT_IMAGES } from "@/features/catalog/domain/product-gallery";
import { imageScopeLabel } from "@/features/catalog/domain/product-media";
import { mappingMessages } from "@/features/catalog/domain/product-media-validation";
import {
  imageTargetValue,
  parseImageTarget,
} from "@/features/admin/domain/image-target";
import {
  combinationKey,
  normalizeOptionText,
  optionKindLabels,
  sameOptionText,
  optionKinds,
  selectionLabel,
  type OptionSelection,
} from "@/features/catalog/domain/product-options";
import { formatIls } from "@/shared/lib/format-currency";
import { parseMoneyInput } from "@/shared/lib/money-input";
import type { ProductImageStore } from "@/server/storage/product-images";

import type { MediaOperation } from "../domain/assistant-policy";
import { canonicalJson, sha256 } from "../domain/confirmation-token";
import { moneyRejection } from "../domain/money-rejection";
import type { EntityCandidate } from "../domain/entity-match";
import type {
  ExecutionResult,
  Handler,
  PrepareResult,
} from "./assistant-operations";
import type { AttachmentService } from "./attachment-service";

export interface MediaOperationServices {
  options: ProductOptionsService;
  attachments: AttachmentService;
  productImages: () => ProductImageStore;
  resolveProduct: (
    actor: AdminActor,
    query: string,
    scope: "product" | "variant",
    field: string,
    purpose?: "change" | "read",
  ) => Promise<
    | { ok: true; match: EntityCandidate; product: Product }
    | { ok: false; result: PrepareResult }
  >;
}

const rejected = (code: string, message: string): PrepareResult => ({
  status: "rejected",
  code,
  message,
});
const productHref = (domainId: string) => `/admin/products/${domainId}`;
const previewUrl = (attachmentId: string) =>
  `/admin/api/assistant/attachments/${attachmentId}`;

export const optionErrorMessages: Record<ProductOptionsError["code"], string> =
  {
    not_found: "العنصر غير موجود أو تغيّر. اطلبي العملية من جديد.",
    invalid_input: "البيانات غير صالحة.",
    duplicate_option: "يوجد خيار بنفس الاسم لهذا المنتج.",
    duplicate_value: "هذه القيمة موجودة في الخيار نفسه.",
    duplicate_combination: "يوجد صنف فعّال بنفس الاختيارات.",
    incomplete_combination: "لازم يكون لكل صنف قيمة من كل خيار.",
    in_use: "مستخدم في أصناف حالية، لذلك لا يُزال الآن.",
    archived: "هذا العنصر مؤرشف.",
    too_many: "وصلت للحد الأقصى المسموح.",
    gallery_full: "المعرض ممتلئ (8 صور كحد أقصى).",
    primary_required: "يجب أن تبقى صورة رئيسية.",
    default_variant: "لا يمكن تطبيق ذلك على الصنف الافتراضي.",
    has_images:
      "صور مرتبطة بهذه القيمة. انقلي الصور أو اجعليها صورة عامة أولاً.",
    primary_must_be_shared: "الصورة الرئيسية يجب أن تكون صورة عامة للمنتج.",
    already_configured:
      "لهذا المنتج خيارات أو أصناف من قبل؛ عدّليها من قسم الخيارات والأصناف.",
  };

type Located = {
  ok: true;
  product: Product;
  matrix: ProductMatrix;
};

export class MediaOperations {
  constructor(private readonly s: MediaOperationServices) {}

  private ownerOnly(actor: AdminActor): PrepareResult | null {
    return can(actor, "settings.manage")
      ? null
      : rejected("forbidden", "تعديل الكتالوج للمالك فقط.");
  }

  async locate(
    actor: AdminActor,
    query: string,
    purpose: "change" | "read" = "change",
  ): Promise<Located | { ok: false; result: PrepareResult }> {
    const found = await this.s.resolveProduct(
      actor,
      query,
      "product",
      "product",
      purpose,
    );
    if (!found.ok) return found;
    const matrix = await this.s.options.matrix(found.product.id);
    if (!matrix)
      return { ok: false, result: rejected("not_found", "المنتج غير موجود.") };
    return { ok: true, product: found.product, matrix };
  }

  private activeImages(matrix: ProductMatrix) {
    return matrix.images.filter((image) => !image.archived);
  }

  private image(
    matrix: ProductMatrix,
    position: number,
    archived = false,
  ): ProductMatrix["images"][number] | PrepareResult {
    const list = matrix.images.filter((image) => image.archived === archived);
    const image = list[position - 1];
    if (!image) {
      return rejected(
        "not_found",
        `لا توجد صورة ${archived ? "مؤرشفة " : ""}برقم ${position}. عدد الصور ${list.length}.`,
      );
    }
    return image;
  }

  private option(matrix: ProductMatrix, name: string, field = "option") {
    const wanted = normalizeOptionText(name);
    const match = matrix.options.find((option) =>
      sameOptionText(option.nameAr, wanted),
    );
    if (match) return match;
    const result: PrepareResult = matrix.options.length
      ? {
          status: "needs_selection",
          field,
          question: `ما في خيار باسم «${name.slice(0, 40)}». أي خيار تقصدين؟`,
          options: matrix.options.map((option) => ({
            id: option.nameAr,
            label: option.nameAr,
          })),
        }
      : rejected("not_found", "لا توجد خيارات لهذا المنتج بعد.");
    return result;
  }

  private value(
    option: ProductMatrix["options"][number],
    text: string,
    field = "value",
  ): { id: string; valueAr: string } | PrepareResult {
    const wanted = normalizeOptionText(text);
    const match = option.values.find((value) =>
      sameOptionText(value.valueAr, wanted),
    );
    if (match) return match;
    return {
      status: "needs_selection",
      field,
      question: `ما في «${text.slice(0, 40)}» في ${option.nameAr}. أي قيمة تقصدين؟`,
      options: option.values.map((value) => ({
        id: value.valueAr,
        label: value.valueAr,
      })),
    };
  }

  private variantByLabel(
    matrix: ProductMatrix,
    text: string,
  ): ProductMatrix["variants"][number] | PrepareResult {
    const wanted = normalizeOptionText(text);
    const live = matrix.variants.filter((variant) => !variant.archived);
    const byId = live.find((variant) => variant.id === text);
    if (byId) return byId;
    const exact = live.filter(
      (variant) => normalizeOptionText(variant.label) === wanted,
    );
    const byValue = live.filter((variant) =>
      Object.values(variant.optionValues).some((valueId) =>
        matrix.options.some((option) =>
          option.values.some(
            (value) =>
              value.id === valueId && sameOptionText(value.valueAr, wanted),
          ),
        ),
      ),
    );
    const matches = exact.length ? exact : byValue;
    if (matches.length === 1) return matches[0]!;
    return {
      status: "needs_selection",
      field: "variant",
      question: matches.length
        ? "أي صنف بالضبط؟"
        : `ما لقيت صنفاً «${text.slice(0, 40)}». اختاري الصنف:`,
      options: (matches.length ? matches : live).map((variant) => ({
        id: variant.id,
        label: variant.label,
      })),
    };
  }

  private isResult(value: unknown): value is PrepareResult {
    return Boolean(value && typeof value === "object" && "status" in value);
  }

  // Reads

  galleryView(located: Located) {
    const variantLabel = (id: string | null) =>
      id
        ? (located.matrix.variants.find((variant) => variant.id === id)
            ?.label ?? null)
        : null;
    return {
      status: "found" as const,
      product: located.product.nameAr,
      images: this.activeImages(located.matrix).map((image, index) => ({
        number: index + 1,
        primary: image.isPrimary,
        alt: image.alt,
        mappedTo: this.mappingLabel(located.matrix, image),
        variant: variantLabel(image.variantId),
      })),
      archived: located.matrix.images
        .filter((image) => image.archived)
        .map((image, index) => ({ number: index + 1, alt: image.alt })),
      limit: MAX_PRODUCT_IMAGES,
    };
  }

  private mappingLabel(
    matrix: ProductMatrix,
    image: Pick<
      ProductMatrix["images"][number],
      | "id"
      | "isPrimary"
      | "sortOrder"
      | "scope"
      | "variantId"
      | "optionId"
      | "optionValueId"
    >,
  ): string {
    if (image.scope === "unassigned") return "غير مربوطة";
    if (image.scope === "product") return "صورة عامة لكل الأصناف";
    const live = matrix.options.filter((option) => !option.archived);
    return (
      imageScopeLabel(image, live, (id) => {
        const variant = matrix.variants.find(
          (row) => row.id === id && !row.archived,
        );
        return variant ? `الصنف ${variant.label}` : null;
      }) ?? mappingMessages.stale
    );
  }

  mappingView(located: Located) {
    const matrix = located.matrix;
    const active = this.activeImages(matrix);
    const live = matrix.options.filter((option) => !option.archived);
    return {
      status: "found" as const,
      product: located.product.nameAr,
      options: live.map((option) => ({
        name: option.nameAr,
        kind: optionKindLabels[option.kind],
        values: option.values.map((value) => ({
          value: value.valueAr,
          usesSharedImage: value.usesSharedImage,
        })),
      })),
      variants: matrix.variants
        .filter((variant) => !variant.archived)
        .map((variant) => ({
          variant: variant.label,
          choices: selectionLabel(live, variant.optionValues) || null,
        })),
      images: active.map((image, index) => ({
        number: index + 1,
        primary: image.isPrimary,
        mappedTo: this.mappingLabel(matrix, image),
      })),
      unmapped: active
        .map((image, index) => ({ image, number: index + 1 }))
        .filter(({ image }) => image.scope === "unassigned")
        .map(({ number }) => number),
      publicationBlockers: [
        ...new Set(matrix.mapping.map((problem) => problem.message)),
      ],
      canPublishImages: matrix.mapping.length === 0,
    };
  }

  optionsView(located: Located) {
    return {
      status: "found" as const,
      product: located.product.nameAr,
      options: located.matrix.options.map((option) => ({
        name: option.nameAr,
        kind: optionKindLabels[option.kind],
        archived: option.archived,
        values: option.values.map((value) => value.valueAr),
        archivedValues: option.archivedValues.map((value) => value.valueAr),
      })),
    };
  }

  matrixView(located: Located) {
    const live = located.matrix.options.filter((option) => !option.archived);
    return {
      status: "found" as const,
      product: located.product.nameAr,
      variants: located.matrix.variants
        .filter((variant) => !variant.archived)
        .map((variant) => ({
          variant: variant.label,
          choices: selectionLabel(live, variant.optionValues) || null,
          price: formatIls(variant.priceAgorot),
          available: variant.availability === "available",
          stock: variant.onHandMilli / 1_000,
          packCount: variant.packCount,
          sku: variant.sku,
          barcode: variant.barcode,
          default: variant.isDefault,
        })),
      missing:
        located.matrix.missing === null
          ? "too_many"
          : located.matrix.missing.map((row) => selectionLabel(live, row)),
      duplicates: located.matrix.duplicates.length,
      incomplete: located.matrix.incomplete.length,
    };
  }

  private card(
    located: Located,
    operation: MediaOperation,
    args: Record<string, unknown>,
    title: string,
    summary: string,
    rows: Array<{ label: string; before: string | null; after: string }>,
    extra: {
      impact?: string[];
      warnings?: string[];
      destructive?: boolean;
      images?: { before: string | null; after: string };
      dependencies?: string[];
      confirmLabel?: string;
    } = {},
  ): PrepareResult {
    return {
      status: "ready",
      operation,
      args: { domainId: located.product.id, ...args },
      summary,
      card: {
        title,
        target: {
          label: located.product.nameAr,
          href: productHref(located.product.id),
        },
        rows,
        impact: extra.impact ?? ["يظهر التغيير في صفحة المنتج بعد التأكيد."],
        warnings: extra.warnings ?? [],
        ...(extra.images ? { images: extra.images } : {}),
        ...(extra.dependencies ? { dependencies: extra.dependencies } : {}),
        confirmLabel: extra.confirmLabel ?? "تأكيد",
        destructive: Boolean(extra.destructive),
        reversible: !extra.destructive,
      },
    };
  }

  // Gallery

  async prepareImagesAdd(
    actor: AdminActor,
    input: { product: string; attachmentIds: string[]; variant?: string },
  ): Promise<PrepareResult> {
    const denied = this.ownerOnly(actor);
    if (denied) return denied;
    const located = await this.locate(actor, input.product);
    if (!located.ok) return located.result;
    const active = this.activeImages(located.matrix);
    if (active.length + input.attachmentIds.length > MAX_PRODUCT_IMAGES) {
      return rejected(
        "too_many",
        `المعرض فيه ${active.length} صور، والحد ${MAX_PRODUCT_IMAGES}.`,
      );
    }
    for (const id of input.attachmentIds) {
      const file = await this.s.attachments.get(actor, id);
      if (!file || file.mimeType !== "image/jpeg") {
        return rejected(
          "unsupported_file",
          "إحدى المرفقات ليست صورة أو انتهت صلاحيتها. أعيدي إرفاقها.",
        );
      }
    }
    let variant: ProductMatrix["variants"][number] | null = null;
    if (input.variant) {
      const found = this.variantByLabel(located.matrix, input.variant);
      if (this.isResult(found)) return found;
      variant = found;
    }
    return this.card(
      located,
      "galleryAdd",
      {
        attachmentIds: input.attachmentIds,
        variantDomainId: variant?.id ?? null,
      },
      "إضافة صور للمنتج",
      `إضافة ${input.attachmentIds.length} صور إلى ${located.product.nameAr}`,
      [
        {
          label: "عدد الصور",
          before: String(active.length),
          after: String(active.length + input.attachmentIds.length),
        },
        {
          label: "تخص",
          before: null,
          after: variant ? variant.label : "كل الأصناف",
        },
      ],
      {
        images: {
          before: active[0]?.src ?? null,
          after: previewUrl(input.attachmentIds[0]!),
        },
        impact: [
          active.length
            ? "تُضاف الصور بعد الصور الحالية."
            : "أول صورة تصبح الصورة الرئيسية.",
        ],
      },
    );
  }

  async prepareGalleryReorder(
    actor: AdminActor,
    input: { product: string; order: number[] },
  ): Promise<PrepareResult> {
    const denied = this.ownerOnly(actor);
    if (denied) return denied;
    const located = await this.locate(actor, input.product);
    if (!located.ok) return located.result;
    const active = this.activeImages(located.matrix);
    const positions = input.order;
    const valid =
      positions.length === active.length &&
      new Set(positions).size === positions.length &&
      positions.every((value) => value >= 1 && value <= active.length);
    if (!valid) {
      return rejected(
        "invalid_input",
        `اذكري ترتيباً كاملاً لكل الصور (${active.length}) مثل 2، 1، 3.`,
      );
    }
    const ids = positions.map((position) => active[position - 1]!.id);
    return this.card(
      located,
      "galleryReorder",
      { imageIds: ids },
      "ترتيب صور المنتج",
      `ترتيب صور ${located.product.nameAr}`,
      [
        {
          label: "الترتيب",
          before: active.map((_, index) => index + 1).join("، "),
          after: positions.join("، "),
        },
      ],
      { impact: ["الصورة الأولى في الترتيب الجديد تصبح الرئيسية."] },
    );
  }

  async prepareGalleryImage(
    actor: AdminActor,
    input: {
      product: string;
      image: number;
      change: "primary" | "alt" | "archive" | "restore" | "delete";
      alt?: string;
    },
  ): Promise<PrepareResult> {
    const denied = this.ownerOnly(actor);
    if (denied) return denied;
    const located = await this.locate(actor, input.product);
    if (!located.ok) return located.result;
    const archived = input.change === "restore" || input.change === "delete";
    const image = this.image(located.matrix, input.image, archived);
    if (this.isResult(image)) return image;
    const name = located.product.nameAr;
    const preview = { before: image.src, after: image.src };
    if (input.change === "primary") {
      if (image.isPrimary)
        return rejected("no_change", "هذه هي الصورة الرئيسية أصلاً.");
      if (image.scope !== "product")
        return rejected(
          "not_shared",
          "الصورة الرئيسية يجب أن تكون صورة عامة. اجعليها صورة عامة أولاً بـ prepareImageMapping.",
        );
      return this.card(
        located,
        "galleryPrimary",
        { imageId: image.id },
        "تغيير الصورة الرئيسية",
        `جعل الصورة ${input.image} رئيسية لـ ${name}`,
        [
          {
            label: "الصورة الرئيسية",
            before: "الصورة 1",
            after: `الصورة ${input.image}`,
          },
        ],
        { images: preview },
      );
    }
    if (input.change === "alt") {
      const alt = (input.alt ?? "").trim();
      if (!alt) return rejected("missing_required_field", "اكتبي وصف الصورة.");
      return this.card(
        located,
        "galleryAlt",
        { imageId: image.id, alt },
        "تعديل وصف الصورة",
        `تعديل وصف الصورة ${input.image}`,
        [{ label: "الوصف", before: image.alt, after: alt }],
        { images: preview },
      );
    }
    if (input.change === "archive" || input.change === "restore") {
      const archive = input.change === "archive";
      return this.card(
        located,
        archive ? "galleryArchive" : "galleryRestore",
        { imageId: image.id },
        archive ? "أرشفة صورة" : "استعادة صورة",
        `${archive ? "أرشفة" : "استعادة"} صورة من ${name}`,
        [
          {
            label: "الحالة",
            before: archive ? "ظاهرة" : "مؤرشفة",
            after: archive ? "مؤرشفة" : "ظاهرة",
          },
        ],
        {
          images: preview,
          impact: [
            archive && image.isPrimary
              ? "الصورة التالية تصبح الرئيسية."
              : "يمكن التراجع لاحقاً.",
          ],
        },
      );
    }
    return this.card(
      located,
      "galleryDelete",
      { imageId: image.id },
      "حذف صورة نهائياً",
      `حذف الصورة المؤرشفة ${input.image} نهائياً`,
      [{ label: "الصورة", before: "مؤرشفة", after: "محذوفة نهائياً" }],
      {
        images: preview,
        destructive: true,
        confirmLabel: "حذف نهائي",
        dependencies: ["لا تؤثر على الطلبات السابقة."],
        impact: ["يُحذف الملف إن لم تستخدمه صورة أخرى."],
      },
    );
  }

  // Image mapping

  async prepareImageMapping(
    actor: AdminActor,
    input: {
      product: string;
      image: number;
      target: "shared" | "value" | "variant" | "unassigned";
      option?: string;
      value?: string;
      variant?: string;
      suggestion?: {
        value: string;
        confidence: number;
        source: "image_analysis";
      };
    },
  ): Promise<PrepareResult> {
    const denied = this.ownerOnly(actor);
    if (denied) return denied;
    const located = await this.locate(actor, input.product);
    if (!located.ok) return located.result;
    const matrix = located.matrix;
    const image = this.image(matrix, input.image);
    if (this.isResult(image)) return image;

    let target = "product";
    let affected: string | null = null;
    let impact = "تظهر الصورة مع كل الأصناف ولا تغيّر اختيار الزبون.";
    if (input.target === "unassigned") {
      target = "unassigned";
      impact = "تختفي الصورة من صفحة المنتج حتى تُربط من جديد.";
    } else if (input.target === "value") {
      if (!input.option || !input.value)
        return rejected(
          "missing_required_field",
          "اذكري الخيار والقيمة، مثل اللون أزرق.",
        );
      const option = this.option(
        { ...matrix, options: matrix.options.filter((row) => !row.archived) },
        input.option,
      );
      if (this.isResult(option)) return option;
      const value = this.value(option, input.value);
      if (this.isResult(value)) return value;
      target = `value:${value.id}`;
      affected = `${option.nameAr}: ${value.valueAr}`;
      const carriers = matrix.variants.filter(
        (variant) =>
          !variant.archived && variant.optionValues[option.id] === value.id,
      );
      impact = `عند اختيار ${affected} تظهر هذه الصورة، والضغط عليها يختار ${value.valueAr} (${carriers.length} أصناف).`;
    } else if (input.target === "variant") {
      if (!input.variant)
        return rejected("missing_required_field", "اذكري الصنف.");
      const variant = this.variantByLabel(matrix, input.variant);
      if (this.isResult(variant)) return variant;
      target = `variant:${variant.id}`;
      affected = `الصنف ${variant.label}`;
      impact = `الضغط على الصورة يختار ${variant.label} بالضبط، وتظهر أولاً عند اختياره.`;
    }
    if (target === imageTargetValue(image))
      return rejected("no_change", "الصورة مربوطة بهذا أصلاً.");
    const parsed = parseImageTarget(target);
    if (!parsed) return rejected("invalid_input", "الربط غير صالح.");

    const warnings: string[] = [];
    if (input.suggestion) {
      warnings.push(
        `هذا الربط مبني على اقتراح من تحليل الصورة («${input.suggestion.value}»، ثقة ${Math.round(input.suggestion.confidence * 100)}٪). تأكدي من الصورة بنفسك قبل التأكيد.`,
      );
    }
    if (image.isPrimary && target !== "product")
      warnings.push("هذه الصورة الرئيسية؛ تصبح الصورة العامة التالية رئيسية.");
    const current = this.mappingLabel(matrix, image);
    const proposed =
      target === "unassigned"
        ? "غير مربوطة"
        : target === "product"
          ? "صورة عامة لكل الأصناف"
          : affected!;
    return this.card(
      located,
      "galleryScope",
      { imageId: image.id, target },
      "ربط صورة بالأصناف",
      `ربط الصورة ${input.image} من ${located.product.nameAr} بـ ${proposed}`,
      [
        { label: "الصورة تخص", before: current, after: proposed },
        ...(affected
          ? [{ label: "يتأثر", before: null, after: affected }]
          : []),
      ],
      {
        images: { before: image.src, after: image.src },
        impact: [impact, "الملف نفسه لا يُحذف ولا يُرفع من جديد."],
        warnings,
      },
    );
  }

  async prepareSharedImageUse(
    actor: AdminActor,
    input: { product: string; option: string; value: string; use: boolean },
  ): Promise<PrepareResult> {
    const denied = this.ownerOnly(actor);
    if (denied) return denied;
    const located = await this.locate(actor, input.product);
    if (!located.ok) return located.result;
    const option = this.option(
      {
        ...located.matrix,
        options: located.matrix.options.filter((row) => !row.archived),
      },
      input.option,
    );
    if (this.isResult(option)) return option;
    const value = this.value(option, input.value);
    if (this.isResult(value)) return value;
    const current = option.values.find((row) => row.id === value.id)!;
    if (current.usesSharedImage === input.use)
      return rejected("no_change", "هذا الإعداد مطبّق أصلاً.");
    const shared = this.activeImages(located.matrix).find(
      (image) => image.scope === "product",
    );
    const label = `${option.nameAr}: ${value.valueAr}`;
    return this.card(
      located,
      "valueSharedImage",
      { valueId: value.id, use: input.use },
      "صورة القيمة",
      input.use
        ? `استخدام الصورة العامة لـ ${label}`
        : `إلغاء استخدام الصورة العامة لـ ${label}`,
      [
        {
          label,
          before: input.use ? "بلا صورة" : "الصورة العامة",
          after: input.use ? "الصورة العامة" : "تحتاج صورة خاصة",
        },
      ],
      {
        ...(shared ? { images: { before: null, after: shared.src } } : {}),
        impact: [
          input.use
            ? `عند اختيار ${label} تظهر الصورة العامة للمنتج.`
            : `يمنع النشر حتى تُضاف صورة لـ ${label}.`,
        ],
        warnings: shared ? [] : ["لا توجد صورة عامة بعد؛ أضيفي واحدة."],
      },
    );
  }

  // Options and values

  async prepareOptionCreate(
    actor: AdminActor,
    input: {
      product: string;
      nameAr: string;
      kind: (typeof optionKinds)[number];
      values: string[];
    },
  ): Promise<PrepareResult> {
    const denied = this.ownerOnly(actor);
    if (denied) return denied;
    const located = await this.locate(actor, input.product);
    if (!located.ok) return located.result;
    const wanted = normalizeOptionText(input.nameAr);
    if (
      located.matrix.options.some((option) =>
        sameOptionText(option.nameAr, wanted),
      )
    ) {
      return rejected(
        "duplicate_option",
        `يوجد خيار «${input.nameAr}» لهذا المنتج. أضيفي القيم إليه بدلاً من خيار جديد.`,
      );
    }
    const values = input.values.map((value) => value.trim()).filter(Boolean);
    if (new Set(values.map(normalizeOptionText)).size !== values.length) {
      return rejected("duplicate_value", "في القيم تكرار.");
    }
    return this.card(
      located,
      "optionCreate",
      { nameAr: input.nameAr.trim(), kind: input.kind, values },
      "إضافة خيار للمنتج",
      `إضافة خيار ${input.nameAr} إلى ${located.product.nameAr}`,
      [
        {
          label: "الخيار",
          before: null,
          after: `${input.nameAr} (${optionKindLabels[input.kind]})`,
        },
        { label: "القيم", before: null, after: values.join("، ") || "—" },
      ],
      {
        impact: [
          "الخيار وحده لا ينشئ أصنافاً؛ الأصناف تُنشأ أو تُربط بخطوة منفصلة.",
        ],
      },
    );
  }

  async prepareOptionChange(
    actor: AdminActor,
    input: {
      product: string;
      option: string;
      change: "rename" | "kind" | "archive" | "restore" | "delete" | "reorder";
      newName?: string;
      kind?: (typeof optionKinds)[number];
      order?: string[];
    },
  ): Promise<PrepareResult> {
    const denied = this.ownerOnly(actor);
    if (denied) return denied;
    const located = await this.locate(actor, input.product);
    if (!located.ok) return located.result;
    if (input.change === "reorder") {
      const live = located.matrix.options.filter((option) => !option.archived);
      const ids: string[] = [];
      for (const name of input.order ?? []) {
        const option = this.option(located.matrix, name, "order");
        if (this.isResult(option)) return option;
        ids.push(option.id);
      }
      if (ids.length !== live.length || new Set(ids).size !== ids.length) {
        return rejected(
          "invalid_input",
          `اذكري كل الخيارات بالترتيب: ${live.map((option) => option.nameAr).join("، ")}.`,
        );
      }
      return this.card(
        located,
        "optionReorder",
        { optionIds: ids },
        "ترتيب الخيارات",
        `ترتيب خيارات ${located.product.nameAr}`,
        [
          {
            label: "الترتيب",
            before: live.map((option) => option.nameAr).join("، "),
            after: (input.order ?? []).join("، "),
          },
        ],
      );
    }
    const option = this.option(located.matrix, input.option);
    if (this.isResult(option)) return option;
    if (input.change === "rename") {
      const name = (input.newName ?? "").trim();
      if (!name)
        return rejected("missing_required_field", "اكتبي الاسم الجديد للخيار.");
      if (
        located.matrix.options.some(
          (row) =>
            row.id !== option.id &&
            normalizeOptionText(row.nameAr) === normalizeOptionText(name),
        )
      ) {
        return rejected("duplicate_option", `يوجد خيار باسم «${name}».`);
      }
      return this.card(
        located,
        "optionUpdate",
        { optionId: option.id, nameAr: name },
        "تغيير اسم خيار",
        `تغيير اسم ${option.nameAr} إلى ${name}`,
        [{ label: "اسم الخيار", before: option.nameAr, after: name }],
        {
          impact: [
            "تتحدث أسماء الأصناف التي تستخدمه. الطلبات السابقة لا تتغير.",
          ],
        },
      );
    }
    if (input.change === "kind") {
      if (!input.kind)
        return rejected("missing_required_field", "حددي نوع الخيار.");
      return this.card(
        located,
        "optionUpdate",
        { optionId: option.id, kind: input.kind },
        "تغيير نوع خيار",
        `تغيير نوع ${option.nameAr}`,
        [
          {
            label: "النوع",
            before: optionKindLabels[option.kind],
            after: optionKindLabels[input.kind],
          },
        ],
      );
    }
    const inUse = located.matrix.variants.filter(
      (variant) => variant.optionValues[option.id],
    );
    const activeUse = inUse.filter((variant) => !variant.archived);
    if (input.change === "archive" || input.change === "restore") {
      const archive = input.change === "archive";
      if (archive && activeUse.length) {
        return rejected(
          "in_use",
          `الخيار مستخدم في ${activeUse.length} أصناف فعّالة. أرشفي الأصناف أولاً.`,
        );
      }
      return this.card(
        located,
        archive ? "optionArchive" : "optionRestore",
        { optionId: option.id },
        archive ? "أرشفة خيار" : "استعادة خيار",
        `${archive ? "أرشفة" : "استعادة"} ${option.nameAr}`,
        [
          {
            label: option.nameAr,
            before: archive ? "فعّال" : "مؤرشف",
            after: archive ? "مؤرشف" : "فعّال",
          },
        ],
      );
    }
    if (inUse.length) {
      return rejected(
        "in_use",
        `الخيار مرتبط بـ ${inUse.length} أصناف، لذلك لا يُحذف نهائياً. أرشفيه بدلاً من ذلك.`,
      );
    }
    return this.card(
      located,
      "optionDelete",
      { optionId: option.id },
      "حذف خيار نهائياً",
      `حذف ${option.nameAr} نهائياً`,
      [
        {
          label: option.nameAr,
          before: `${option.values.length} قيم`,
          after: "محذوف نهائياً",
        },
      ],
      {
        destructive: true,
        confirmLabel: "حذف نهائي",
        dependencies: ["غير مرتبط بأي صنف."],
      },
    );
  }

  async prepareValueChange(
    actor: AdminActor,
    input: {
      product: string;
      option: string;
      change: "add" | "rename" | "archive" | "restore" | "delete" | "reorder";
      values?: string[];
      value?: string;
      newValue?: string;
    },
  ): Promise<PrepareResult> {
    const denied = this.ownerOnly(actor);
    if (denied) return denied;
    const located = await this.locate(actor, input.product);
    if (!located.ok) return located.result;
    const option = this.option(located.matrix, input.option);
    if (this.isResult(option)) return option;
    if (input.change === "add") {
      const values = (input.values ?? [])
        .map((value) => value.trim())
        .filter(Boolean);
      const existing = new Set(
        option.values.map((value) => normalizeOptionText(value.valueAr)),
      );
      const clash = values.find((value) =>
        existing.has(normalizeOptionText(value)),
      );
      if (!values.length)
        return rejected(
          "missing_required_field",
          "اذكري القيم المطلوب إضافتها.",
        );
      if (clash)
        return rejected(
          "duplicate_value",
          `«${clash}» موجودة في ${option.nameAr}.`,
        );
      if (new Set(values.map(normalizeOptionText)).size !== values.length)
        return rejected("duplicate_value", "في القيم تكرار.");
      return this.card(
        located,
        "valueAdd",
        { optionId: option.id, values },
        `إضافة قيم إلى ${option.nameAr}`,
        `إضافة ${values.join("، ")} إلى ${option.nameAr}`,
        [
          {
            label: option.nameAr,
            before:
              option.values.map((value) => value.valueAr).join("، ") || "—",
            after: [
              ...option.values.map((value) => value.valueAr),
              ...values,
            ].join("، "),
          },
        ],
        { impact: ["القيم الجديدة لا تنشئ أصنافاً وحدها."] },
      );
    }
    if (input.change === "reorder") {
      const ids: string[] = [];
      for (const text of input.values ?? []) {
        const value = this.value(option, text);
        if (this.isResult(value)) return value;
        ids.push(value.id);
      }
      if (
        ids.length !== option.values.length ||
        new Set(ids).size !== ids.length
      ) {
        return rejected(
          "invalid_input",
          `اذكري كل القيم بالترتيب: ${option.values.map((value) => value.valueAr).join("، ")}.`,
        );
      }
      return this.card(
        located,
        "valueReorder",
        { optionId: option.id, valueIds: ids },
        `ترتيب قيم ${option.nameAr}`,
        `ترتيب قيم ${option.nameAr}`,
        [
          {
            label: option.nameAr,
            before: option.values.map((value) => value.valueAr).join("، "),
            after: (input.values ?? []).join("، "),
          },
        ],
      );
    }
    const lookup =
      input.change === "restore" || input.change === "delete"
        ? (() => {
            const all = [...option.values, ...option.archivedValues];
            const match = all.find(
              (value) =>
                normalizeOptionText(value.valueAr) ===
                normalizeOptionText(input.value ?? ""),
            );
            return match ?? this.value(option, input.value ?? "");
          })()
        : this.value(option, input.value ?? "");
    if (this.isResult(lookup)) return lookup;
    const users = located.matrix.variants.filter(
      (variant) => variant.optionValues[option.id] === lookup.id,
    );
    const activeUsers = users.filter((variant) => !variant.archived);
    if (input.change === "rename") {
      const text = (input.newValue ?? "").trim();
      if (!text)
        return rejected("missing_required_field", "اكتبي القيمة الجديدة.");
      if (
        option.values.some(
          (value) =>
            value.id !== lookup.id &&
            normalizeOptionText(value.valueAr) === normalizeOptionText(text),
        )
      ) {
        return rejected(
          "duplicate_value",
          `«${text}» موجودة في ${option.nameAr}.`,
        );
      }
      return this.card(
        located,
        "valueUpdate",
        { valueId: lookup.id, valueAr: text },
        "تعديل قيمة",
        `تغيير ${lookup.valueAr} إلى ${text}`,
        [{ label: option.nameAr, before: lookup.valueAr, after: text }],
        {
          impact: [
            `يتغير اسم ${users.length} أصناف تستخدمها. الطلبات والفواتير السابقة لا تتغير.`,
          ],
        },
      );
    }
    if (input.change === "archive" || input.change === "restore") {
      const archive = input.change === "archive";
      if (archive && activeUsers.length) {
        return rejected(
          "in_use",
          `«${lookup.valueAr}» مستخدمة في ${activeUsers.length} أصناف فعّالة. أرشفي الصنف أولاً.`,
        );
      }
      return this.card(
        located,
        archive ? "valueArchive" : "valueRestore",
        { valueId: lookup.id },
        archive ? "أرشفة قيمة" : "استعادة قيمة",
        `${archive ? "أرشفة" : "استعادة"} ${lookup.valueAr}`,
        [
          {
            label: option.nameAr,
            before: lookup.valueAr,
            after: archive ? "مؤرشفة" : "فعّالة",
          },
        ],
      );
    }
    if (users.length) {
      return rejected(
        "in_use",
        `«${lookup.valueAr}» مرتبطة بـ ${users.length} أصناف، لذلك لا تُحذف نهائياً. أرشفيها بدلاً من ذلك.`,
      );
    }
    return this.card(
      located,
      "valueDelete",
      { valueId: lookup.id },
      "حذف قيمة نهائياً",
      `حذف ${lookup.valueAr} نهائياً`,
      [
        {
          label: option.nameAr,
          before: lookup.valueAr,
          after: "محذوفة نهائياً",
        },
      ],
      {
        destructive: true,
        confirmLabel: "حذف نهائي",
        dependencies: ["غير مرتبطة بأي صنف."],
      },
    );
  }

  // Variants

  private selectionFrom(
    matrix: ProductMatrix,
    values: Record<string, string>,
  ): OptionSelection | PrepareResult {
    const live = matrix.options.filter((option) => !option.archived);
    const selection: Record<string, string> = {};
    for (const [name, text] of Object.entries(values)) {
      const option = this.option(matrix, name);
      if (this.isResult(option)) return option;
      const value = this.value(option, text);
      if (this.isResult(value)) return value;
      selection[option.id] = value.id;
    }
    const missing = live.filter((option) => !selection[option.id]);
    if (missing.length) {
      return rejected(
        "incomplete_combination",
        `حددي ${missing.map((option) => option.nameAr).join(" و")}.`,
      );
    }
    return selection;
  }

  async prepareVariantGeneration(
    actor: AdminActor,
    input: {
      product: string;
      mode: "missing" | "listed";
      combinations?: Array<Record<string, string>>;
      priceIls: string;
      packCount?: number;
    },
  ): Promise<PrepareResult> {
    const denied = this.ownerOnly(actor);
    if (denied) return denied;
    const located = await this.locate(actor, input.product);
    if (!located.ok) return located.result;
    const price = parseMoneyInput(input.priceIls);
    if (!price.ok) return moneyRejection(input.priceIls);
    const live = located.matrix.options.filter((option) => !option.archived);
    if (!live.length)
      return rejected("missing_required_field", "أضيفي خياراً وقيمه أولاً.");
    let selections: OptionSelection[];
    if (input.mode === "missing") {
      if (located.matrix.missing === null)
        return rejected(
          "too_many",
          "التركيبات كثيرة جداً؛ اذكري الأصناف المطلوبة.",
        );
      selections = located.matrix.missing;
    } else {
      selections = [];
      for (const row of input.combinations ?? []) {
        const selection = this.selectionFrom(located.matrix, row);
        if (this.isResult(selection)) return selection;
        selections.push(selection);
      }
    }
    if (!selections.length)
      return rejected("no_change", "كل التركيبات موجودة أصلاً.");
    const existing = new Set(
      located.matrix.variants
        .filter((variant) => !variant.archived)
        .map((variant) => combinationKey(variant.optionValues)),
    );
    const keys = selections.map((selection) => combinationKey(selection));
    const clash = selections.find((selection) =>
      existing.has(combinationKey(selection)),
    );
    if (clash)
      return rejected(
        "duplicate_combination",
        `الصنف «${selectionLabel(live, clash)}» موجود أصلاً.`,
      );
    if (new Set(keys).size !== keys.length)
      return rejected("duplicate_combination", "في التركيبات تكرار.");
    return this.card(
      located,
      "variantsGenerate",
      {
        rows: selections.map((selection) => ({
          selection,
          priceAgorot: price.agorot,
          packCount: input.packCount ?? null,
        })),
      },
      "إضافة أصناف",
      `إضافة ${selections.length} أصناف إلى ${located.product.nameAr}`,
      selections.map((selection) => ({
        label: "صنف جديد",
        before: null,
        after: `${selectionLabel(live, selection)} — ${formatIls(price.agorot)}`,
      })),
      {
        impact: [
          "الأصناف الجديدة بدون مخزون؛ يُسجل المخزون بالمشتريات أو التصحيح.",
          ...(input.packCount
            ? [
                `كل وحدة بيع فيها ${input.packCount} قطع، والمخزون يُعد بالوحدة.`,
              ]
            : []),
        ],
      },
    );
  }

  async prepareVariantChoices(
    actor: AdminActor,
    input: {
      product: string;
      variant: string;
      values: Record<string, string>;
      packCount?: number | null;
    },
  ): Promise<PrepareResult> {
    const denied = this.ownerOnly(actor);
    if (denied) return denied;
    const located = await this.locate(actor, input.product);
    if (!located.ok) return located.result;
    const variant = this.variantByLabel(located.matrix, input.variant);
    if (this.isResult(variant)) return variant;
    const live = located.matrix.options.filter((option) => !option.archived);
    const selection = this.selectionFrom(located.matrix, {
      ...Object.fromEntries(
        live
          .filter((option) => variant.optionValues[option.id])
          .map((option) => [
            option.nameAr,
            option.values.find(
              (value) => value.id === variant.optionValues[option.id],
            )?.valueAr ?? "",
          ]),
      ),
      ...input.values,
    });
    if (this.isResult(selection)) return selection;
    const clash = located.matrix.variants.find(
      (row) =>
        !row.archived &&
        row.id !== variant.id &&
        combinationKey(row.optionValues) === combinationKey(selection),
    );
    if (clash)
      return rejected(
        "duplicate_combination",
        `يوجد صنف بنفس الاختيارات: ${clash.label}.`,
      );
    return this.card(
      located,
      "variantOptions",
      {
        variantDomainId: variant.id,
        selection,
        packCount:
          input.packCount === undefined ? variant.packCount : input.packCount,
      },
      "تعديل اختيارات صنف",
      `تعديل ${variant.label}`,
      [
        {
          label: "الاختيارات",
          before: selectionLabel(live, variant.optionValues) || variant.label,
          after: selectionLabel(live, selection),
        },
        ...(input.packCount !== undefined
          ? [
              {
                label: "القطع في العبوة",
                before: variant.packCount ? String(variant.packCount) : "—",
                after: input.packCount ? String(input.packCount) : "—",
              },
            ]
          : []),
      ],
      {
        impact: [
          "السعر والمخزون والباركود لا تتغير.",
          "الطلبات السابقة تحتفظ بالاسم القديم.",
        ],
      },
    );
  }

  // Builds the creation card only from the stored draft; the model supplies nothing here.
  prepareProductSet(
    actor: AdminActor,
    input: {
      set: Omit<ProductSetInput, "images">;
      attachments: Array<{
        attachmentId: string;
        variantIndex: number | null;
        primary: boolean;
      }>;
      categoryName: string;
    },
  ): PrepareResult {
    const denied = this.ownerOnly(actor);
    if (denied) return denied;
    if (
      input.set.variants.some((row) => row.openingStock) &&
      !can(actor, "stock.adjust")
    ) {
      return rejected("forbidden", "الرصيد الافتتاحي للمالك فقط.");
    }
    const parsed = productSetSchema.omit({ images: true }).safeParse(input.set);
    if (!parsed.success)
      return rejected("invalid_input", "بيانات المسودة غير مكتملة.");
    const set = parsed.data;
    const title = (values: Record<string, string>) =>
      Object.values(values).join(" · ");
    const stock = set.variants.filter((row) => row.openingStock);
    return {
      status: "ready",
      operation: "productSetCreate",
      args: { set, attachments: input.attachments },
      summary: `إضافة ${set.product.nameAr} مع ${set.variants.length} أصناف`,
      card: {
        title: "إضافة منتج بأصناف",
        target: { label: set.product.nameAr, href: null },
        rows: [
          { label: "القسم", before: null, after: input.categoryName },
          ...set.options.map((option) => ({
            label: option.nameAr,
            before: null,
            after: option.values.join("، "),
          })),
          ...set.variants.map((row) => ({
            label: "صنف",
            before: null,
            after: `${title(row.values)} — ${formatIls(row.priceAgorot)}${row.packCount ? ` — ${row.packCount} قطع` : ""}`,
          })),
          ...input.attachments.map((item, index) => ({
            label: `الصورة ${index + 1}`,
            before: null,
            after: `${item.primary ? "رئيسية · " : ""}${
              item.variantIndex === null
                ? "للمنتج كله"
                : title(set.variants[item.variantIndex]!.values)
            }`,
          })),
        ],
        impact: [
          stock.length
            ? `يُسجل رصيد افتتاحي لـ ${stock.length} أصناف بالتكلفة المذكورة.`
            : "الأصناف بدون مخزون؛ يُسجل المخزون بالمشتريات.",
          "كل شيء يُنشأ معاً؛ إذا فشل جزء لا يُحفظ شيء.",
        ],
        warnings: [],
        ...(input.attachments[0]
          ? {
              images: {
                before: null,
                after: previewUrl(input.attachments[0].attachmentId),
              },
            }
          : {}),
        confirmLabel: "تأكيد الإضافة",
        destructive: false,
        reversible: true,
      },
    };
  }

  buildHandlers(): Record<MediaOperation, Handler<never>> {
    const options = this.s.options;
    const version = (_actor: AdminActor, args: { domainId: string }) =>
      options.version(args.domainId);
    const done = (message: string, domainId: string): ExecutionResult => ({
      message,
      href: productHref(domainId),
      ref: `product:${domainId}`,
    });
    const store = this.s.productImages;
    const attachments = this.s.attachments;
    // Files are stored before the database change; any failure removes them again.
    const publish = async (actor: AdminActor, ids: string[]) => {
      const stored: Array<{ src: string; width: number; height: number }> = [];
      try {
        for (const id of ids) {
          const file = await attachments.read(actor, id);
          if (!file || file.mimeType !== "image/jpeg")
            throw new Error("attachment_missing");
          const webp = await sharp(file.bytes)
            .resize(1_600, 1_600, { fit: "inside", withoutEnlargement: true })
            .webp({ quality: 86 })
            .toBuffer();
          stored.push(await store().put(webp));
        }
      } catch (error) {
        await cleanup(stored);
        throw error;
      }
      return stored;
    };
    const cleanup = (stored: Array<{ src: string }>) =>
      Promise.all(
        stored.map((item) =>
          store()
            .remove?.(item.src)
            .catch(() => false),
        ),
      );
    const base = z.object({ domainId: z.string() });
    const imageArgs = base.extend({ imageId: z.uuid() });
    const optionArgs = base.extend({ optionId: z.uuid() });
    const valueArgs = base.extend({ valueId: z.uuid() });
    const withAttachments = async (
      actor: AdminActor,
      args: { domainId: string; attachmentIds: string[] },
    ) => {
      for (const id of args.attachmentIds) {
        if (!(await attachments.get(actor, id))) return null;
      }
      return options.version(args.domainId);
    };

    const handlers = {
      galleryAdd: {
        args: base.extend({
          attachmentIds: z.array(z.uuid()).min(1).max(8),
          variantDomainId: z.string().nullable(),
        }),
        version: withAttachments,
        async execute(actor, args) {
          const stored = await publish(actor, args.attachmentIds);
          try {
            await options.addImages(
              actor,
              args.domainId,
              stored.map((item) => ({
                ...item,
                alt: "صورة المنتج",
                variantDomainId: args.variantDomainId,
              })),
            );
          } catch (error) {
            await cleanup(stored);
            throw error;
          }
          for (const id of args.attachmentIds) await attachments.markUsed(id);
          return done(`تمت إضافة ${stored.length} صور.`, args.domainId);
        },
      } satisfies Handler<{
        domainId: string;
        attachmentIds: string[];
        variantDomainId: string | null;
      }>,
      galleryReorder: {
        args: base.extend({ imageIds: z.array(z.uuid()).min(1).max(8) }),
        version,
        async execute(actor, args) {
          await options.reorderImages(actor, args.domainId, args.imageIds);
          return done("تم ترتيب الصور.", args.domainId);
        },
      } satisfies Handler<{ domainId: string; imageIds: string[] }>,
      galleryPrimary: {
        args: imageArgs,
        version,
        async execute(actor, args) {
          await options.setPrimaryImage(actor, args.imageId);
          return done("تم تغيير الصورة الرئيسية.", args.domainId);
        },
      } satisfies Handler<{ domainId: string; imageId: string }>,
      galleryAlt: {
        args: imageArgs.extend({ alt: z.string().min(1).max(250) }),
        version,
        async execute(actor, args) {
          await options.updateImageAlt(actor, args.imageId, args.alt);
          return done("تم حفظ وصف الصورة.", args.domainId);
        },
      } satisfies Handler<{ domainId: string; imageId: string; alt: string }>,
      galleryAssign: {
        args: imageArgs.extend({ variantDomainId: z.string().nullable() }),
        version,
        async execute(actor, args) {
          await options.assignImage(actor, args.imageId, args.variantDomainId);
          return done("تم ربط الصورة.", args.domainId);
        },
      } satisfies Handler<{
        domainId: string;
        imageId: string;
        variantDomainId: string | null;
      }>,
      galleryScope: {
        args: imageArgs.extend({ target: z.string().min(1).max(120) }),
        version,
        async execute(actor, args) {
          const target = parseImageTarget(args.target);
          if (!target) throw new ProductOptionsError("invalid_input");
          await options.setImageScope(actor, args.imageId, target);
          return done("تم ربط الصورة.", args.domainId);
        },
      } satisfies Handler<{
        domainId: string;
        imageId: string;
        target: string;
      }>,
      valueSharedImage: {
        args: valueArgs.extend({ use: z.boolean() }),
        version,
        async execute(actor, args) {
          await options.setValueSharedImage(actor, args.valueId, args.use);
          return done(
            args.use
              ? "ستظهر الصورة العامة لهذه القيمة."
              : "أُلغي استخدام الصورة العامة.",
            args.domainId,
          );
        },
      } satisfies Handler<{ domainId: string; valueId: string; use: boolean }>,
      galleryArchive: {
        args: imageArgs,
        version,
        async execute(actor, args) {
          await options.setImageArchived(actor, args.imageId, true);
          return done("تمت أرشفة الصورة.", args.domainId);
        },
      } satisfies Handler<{ domainId: string; imageId: string }>,
      galleryRestore: {
        args: imageArgs,
        version,
        async execute(actor, args) {
          await options.setImageArchived(actor, args.imageId, false);
          return done("تمت استعادة الصورة.", args.domainId);
        },
      } satisfies Handler<{ domainId: string; imageId: string }>,
      galleryDelete: {
        args: imageArgs,
        version,
        async execute(actor, args) {
          const removed = await options.deleteImage(actor, args.imageId);
          if (!removed.fileStillUsed)
            await store()
              .remove?.(removed.src)
              .catch(() => false);
          return done("تم حذف الصورة نهائياً.", args.domainId);
        },
      } satisfies Handler<{ domainId: string; imageId: string }>,
      optionCreate: {
        args: base.extend({
          nameAr: z.string().min(1).max(40),
          kind: z.enum(optionKinds),
          values: z.array(z.string().min(1).max(60)).max(20),
        }),
        version,
        async execute(actor, args) {
          await options.createOption(actor, args.domainId, args);
          return done(`تمت إضافة خيار ${args.nameAr}.`, args.domainId);
        },
      } satisfies Handler<{
        domainId: string;
        nameAr: string;
        kind: (typeof optionKinds)[number];
        values: string[];
      }>,
      optionUpdate: {
        args: optionArgs.extend({
          nameAr: z.string().min(1).max(40).optional(),
          kind: z.enum(optionKinds).optional(),
        }),
        version,
        async execute(actor, args) {
          await options.updateOption(actor, args.optionId, {
            nameAr: args.nameAr,
            kind: args.kind,
          });
          return done("تم تعديل الخيار.", args.domainId);
        },
      } satisfies Handler<{
        domainId: string;
        optionId: string;
        nameAr?: string;
        kind?: (typeof optionKinds)[number];
      }>,
      optionReorder: {
        args: base.extend({ optionIds: z.array(z.uuid()).min(1).max(4) }),
        version,
        async execute(actor, args) {
          await options.reorderOptions(actor, args.domainId, args.optionIds);
          return done("تم ترتيب الخيارات.", args.domainId);
        },
      } satisfies Handler<{ domainId: string; optionIds: string[] }>,
      optionArchive: {
        args: optionArgs,
        version,
        async execute(actor, args) {
          await options.setOptionArchived(actor, args.optionId, true);
          return done("تمت أرشفة الخيار.", args.domainId);
        },
      } satisfies Handler<{ domainId: string; optionId: string }>,
      optionRestore: {
        args: optionArgs,
        version,
        async execute(actor, args) {
          await options.setOptionArchived(actor, args.optionId, false);
          return done("تمت استعادة الخيار.", args.domainId);
        },
      } satisfies Handler<{ domainId: string; optionId: string }>,
      optionDelete: {
        args: optionArgs,
        version,
        async execute(actor, args) {
          await options.deleteOption(actor, args.optionId);
          return done("تم حذف الخيار نهائياً.", args.domainId);
        },
      } satisfies Handler<{ domainId: string; optionId: string }>,
      valueAdd: {
        args: optionArgs.extend({
          values: z.array(z.string().min(1).max(60)).min(1).max(20),
        }),
        version,
        async execute(actor, args) {
          for (const value of args.values)
            await options.addValue(actor, args.optionId, value);
          return done("تمت إضافة القيم.", args.domainId);
        },
      } satisfies Handler<{
        domainId: string;
        optionId: string;
        values: string[];
      }>,
      valueUpdate: {
        args: valueArgs.extend({ valueAr: z.string().min(1).max(60) }),
        version,
        async execute(actor, args) {
          await options.updateValue(actor, args.valueId, args.valueAr);
          return done("تم تعديل القيمة.", args.domainId);
        },
      } satisfies Handler<{
        domainId: string;
        valueId: string;
        valueAr: string;
      }>,
      valueReorder: {
        args: optionArgs.extend({ valueIds: z.array(z.uuid()).min(1).max(20) }),
        version,
        async execute(actor, args) {
          await options.reorderValues(actor, args.optionId, args.valueIds);
          return done("تم ترتيب القيم.", args.domainId);
        },
      } satisfies Handler<{
        domainId: string;
        optionId: string;
        valueIds: string[];
      }>,
      valueArchive: {
        args: valueArgs,
        version,
        async execute(actor, args) {
          await options.setValueArchived(actor, args.valueId, true);
          return done("تمت أرشفة القيمة.", args.domainId);
        },
      } satisfies Handler<{ domainId: string; valueId: string }>,
      valueRestore: {
        args: valueArgs,
        version,
        async execute(actor, args) {
          await options.setValueArchived(actor, args.valueId, false);
          return done("تمت استعادة القيمة.", args.domainId);
        },
      } satisfies Handler<{ domainId: string; valueId: string }>,
      valueDelete: {
        args: valueArgs,
        version,
        async execute(actor, args) {
          await options.deleteValue(actor, args.valueId);
          return done("تم حذف القيمة نهائياً.", args.domainId);
        },
      } satisfies Handler<{ domainId: string; valueId: string }>,
      variantsGenerate: {
        args: base.extend({
          rows: z
            .array(
              z.object({
                selection: z.record(z.uuid(), z.uuid()),
                priceAgorot: z.number().int().positive(),
                packCount: z.number().int().min(1).max(1_000).nullable(),
              }),
            )
            .min(1)
            .max(60),
        }),
        version,
        async execute(actor, args, key) {
          const result = await options.generateVariants(
            actor,
            args.domainId,
            args.rows,
            key,
          );
          return done(
            `تمت إضافة ${result.variantIds.length} أصناف.`,
            args.domainId,
          );
        },
      } satisfies Handler<{
        domainId: string;
        rows: Array<{
          selection: Record<string, string>;
          priceAgorot: number;
          packCount: number | null;
        }>;
      }>,
      variantOptions: {
        args: base.extend({
          variantDomainId: z.string(),
          selection: z.record(z.uuid(), z.uuid()),
          packCount: z.number().int().min(1).max(1_000).nullable(),
        }),
        version,
        async execute(actor, args) {
          await options.setVariantSelection(actor, args.variantDomainId, {
            selection: args.selection,
            packCount: args.packCount,
          });
          return done("تم تعديل اختيارات الصنف.", args.domainId);
        },
      } satisfies Handler<{
        domainId: string;
        variantDomainId: string;
        selection: Record<string, string>;
        packCount: number | null;
      }>,
      productSetCreate: {
        args: z.object({
          set: z.record(z.string(), z.unknown()),
          attachments: z
            .array(
              z.object({
                attachmentId: z.uuid(),
                variantIndex: z.number().int().min(0).max(59).nullable(),
                primary: z.boolean(),
              }),
            )
            .max(8),
        }),
        async version(actor, args) {
          for (const item of args.attachments) {
            if (!(await attachments.get(actor, item.attachmentId))) return null;
          }
          return sha256(canonicalJson(args));
        },
        async execute(actor, args, key) {
          const set = productSetSchema.omit({ images: true }).parse(args.set);
          const stored = await publish(
            actor,
            args.attachments.map((item) => item.attachmentId),
          );
          let result;
          try {
            result = await options.createProductSet(
              actor,
              {
                ...(set as Omit<ProductSetInput, "images">),
                images: stored.map((item, index) => ({
                  ...item,
                  alt: set.product.nameAr,
                  variantIndex: args.attachments[index]!.variantIndex,
                  primary: args.attachments[index]!.primary,
                })),
              },
              key,
            );
          } catch (error) {
            await cleanup(stored);
            throw error;
          }
          if (result.replayed) await cleanup(stored);
          for (const item of args.attachments)
            await attachments.markUsed(item.attachmentId);
          return {
            message: `تمت إضافة ${set.product.nameAr} مع ${set.variants.length} أصناف.`,
            href: productHref(result.domainId),
            ref: `product:${result.domainId}`,
          };
        },
      } satisfies Handler<{
        set: Record<string, unknown>;
        attachments: Array<{
          attachmentId: string;
          variantIndex: number | null;
          primary: boolean;
        }>;
      }>,
    };
    return handlers as unknown as Record<MediaOperation, Handler<never>>;
  }
}
