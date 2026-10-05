import "server-only";

import sharp from "sharp";
import { z } from "zod";

import type { AdminCatalogService } from "@/features/admin/application/admin-catalog-service";
import {
  CatalogAuthoringError,
  type CatalogAuthoringService,
  type DuplicateCandidate,
} from "@/features/admin/application/catalog-authoring-service";
import type { AdminActor } from "@/features/admin/domain/admin-actor";
import { can } from "@/features/admin/domain/permissions";
import {
  categoryCodeFrom,
  categoryCodeSchema,
  categoryIconKeys,
  categoryIconLabels,
  type AdminProductCategory,
  type CategoryIconKey,
} from "@/features/catalog/domain/category";
import { type Product } from "@/features/catalog/domain/product";
import {
  formatQuantity,
  parseQuantityToMilli,
} from "@/features/inventory/domain/quantity";
import { formatIls } from "@/shared/lib/format-currency";
import { lineTotalAgorot } from "@/shared/lib/money-math";
import { parseIlsToAgorot } from "@/shared/lib/parse-ils";
import { moneyRejection } from "@/features/assistant/domain/money-rejection";
import type { ProductImageStore } from "@/server/storage/product-images";

import type { CatalogOperation } from "../domain/assistant-policy";
import { canonicalJson, sha256 } from "../domain/confirmation-token";
import {
  forChanges,
  resolveCatalogEntity,
  selectionQuestion,
  type EntityCandidate,
} from "../domain/entity-match";
import type {
  ConfirmationCard,
  ExecutionResult,
  Handler,
  PrepareResult,
} from "./assistant-operations";
import type { AttachmentService } from "./attachment-service";

const productHref = (domainId: string) => `/admin/products/${domainId}`;
const categoriesHref = "/admin/products";
const rejected = (code: string, message: string): PrepareResult => ({
  status: "rejected",
  code,
  message,
});
const availabilityLabel = (value: string) =>
  value === "available" ? "متوفر للبيع" : "غير متوفر";

export const publicationStates = [
  "draft",
  "published",
  "published_unavailable",
  "hidden",
] as const;
export type PublicationState = (typeof publicationStates)[number];

const publicationLabels: Record<PublicationState, string> = {
  draft: "مسودة (غير ظاهر في المتجر)",
  published: "منشور ومتوفر للبيع",
  published_unavailable: "منشور لكن غير متوفر",
  hidden: "مخفي من المتجر",
};

function publicationOf(
  publication: string,
  availability: string,
): PublicationState {
  if (publication === "published") {
    return availability === "available" ? "published" : "published_unavailable";
  }
  return publication === "draft" ? "draft" : "hidden";
}

function stateFields(state: PublicationState) {
  return {
    publication: state.startsWith("published")
      ? ("published" as const)
      : (state as "draft" | "hidden"),
    availability:
      state === "published" ? ("available" as const) : ("unavailable" as const),
  };
}

const storefrontImpact: Record<PublicationState, string> = {
  draft: "لن يظهر المنتج في المتجر ولا في البحث.",
  published: "سيظهر المنتج في المتجر ويمكن طلبه.",
  published_unavailable:
    "سيظهر المنتج في المتجر بعلامة «غير متوفر» ولا يمكن طلبه.",
  hidden: "سيختفي المنتج من المتجر والبحث، ويبقى في لوحة الإدارة.",
};

export const variantAttributeInput = z
  .object({
    size: z.string().trim().max(40).optional(),
    volume: z.string().trim().max(40).optional(),
    weight: z.string().trim().max(40).optional(),
    fragrance: z.string().trim().max(40).optional(),
    color: z.string().trim().max(40).optional(),
    packageCount: z.string().trim().max(10).optional(),
  })
  .strict();
type VariantAttributeInput = z.infer<typeof variantAttributeInput>;

const attributeLabels: Record<keyof VariantAttributeInput, string> = {
  size: "الحجم",
  volume: "السعة",
  weight: "الوزن",
  fragrance: "الرائحة",
  color: "اللون",
  packageCount: "عدد القطع",
};

function toAttributes(input: VariantAttributeInput | undefined) {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(input ?? {})) {
    if (value?.trim()) {
      result[attributeLabels[key as keyof VariantAttributeInput]] =
        value.trim();
    }
  }
  return result;
}

const identifierPattern = /^[A-Za-z0-9._-]{3,64}$/;

function identifierProblem(value: string | null | undefined, label: string) {
  if (!value) return null;
  return identifierPattern.test(value)
    ? null
    : `${label} يجب أن يكون بالأحرف اللاتينية والأرقام فقط (3 إلى 64).`;
}

function authoringMessage(error: CatalogAuthoringError): string {
  const messages: Partial<Record<CatalogAuthoringError["code"], string>> = {
    duplicate_sku: "رمز SKU مستخدم لصنف آخر.",
    duplicate_barcode: "الباركود مستخدم لصنف آخر.",
    duplicate_slug: "رابط المنتج مستخدم لمنتج آخر.",
    duplicate_variant: "يوجد صنف بنفس الاسم أو الخصائص لهذا المنتج.",
    duplicate_category: "يوجد قسم بنفس الاسم.",
    category_not_empty: "القسم فيه منتجات؛ انقليها أو ادمجي القسم أولاً.",
    category_unavailable: "القسم غير موجود أو مؤرشف.",
    in_use: "مرتبط بسجلات تاريخية ولا يمكن حذفه؛ استخدمي الأرشفة.",
    default_variant:
      "هذا هو الصنف الافتراضي؛ اختاري صنفاً افتراضياً آخر أولاً.",
    stock_on_hand: "لهذا الصنف كمية في المخزون؛ صفّريها أو انقليها أولاً.",
    not_publishable: "المنتج غير جاهز للنشر.",
    breaks_published: "المنتج منشور، وهذا التغيير يتركه غير صالح للعرض.",
  };
  const message = messages[error.code] ?? "تعذّر تجهيز العملية.";
  return (error.code === "not_publishable" ||
    error.code === "breaks_published") &&
    error.detail &&
    error.detail !== "placeholder"
    ? `${message} ${error.detail}`
    : message;
}

export interface CatalogOperationServices {
  catalog: AdminCatalogService;
  authoring: CatalogAuthoringService;
  attachments: AttachmentService;
  productImages: () => ProductImageStore;
  hasOptions: (domainId: string) => Promise<boolean>;
  resolveProduct: (
    actor: AdminActor,
    query: string,
    scope: "product" | "variant",
    field: string,
  ) => Promise<
    | { ok: true; match: EntityCandidate; product: Product }
    | { ok: false; result: PrepareResult }
  >;
  resolveVariant: (
    actor: AdminActor,
    query: string,
    field: string,
  ) => Promise<
    | { ok: true; match: EntityCandidate; product: Product }
    | { ok: false; result: PrepareResult }
  >;
}

async function storeAttachmentImage(
  services: CatalogOperationServices,
  actor: AdminActor,
  attachmentId: string,
) {
  const file = await services.attachments.read(actor, attachmentId);
  if (!file || file.mimeType !== "image/jpeg") {
    throw new Error("attachment_missing");
  }
  const webp = await sharp(file.bytes)
    .resize(1_200, 1_200, { fit: "inside", withoutEnlargement: true })
    .webp({ quality: 88 })
    .toBuffer();
  const stored = await services.productImages().put(webp);
  await services.attachments.markUsed(attachmentId);
  return stored;
}

export class CatalogOperations {
  constructor(private readonly services: CatalogOperationServices) {}

  private ownerOnly(actor: AdminActor): PrepareResult | null {
    return can(actor, "settings.manage")
      ? null
      : rejected("forbidden", "تعديل الكتالوج للمالك فقط.");
  }

  async resolveCategory(
    query: string,
    options: { includeArchived?: boolean; field?: string } = {},
  ): Promise<
    | {
        ok: true;
        category: AdminProductCategory;
        categories: AdminProductCategory[];
      }
    | { ok: false; result: PrepareResult }
  > {
    const categories = await this.services.authoring.listCategories(
      options.includeArchived ?? false,
    );
    const text = query.trim().toLowerCase();
    const exact = categories.find(
      (row) => row.code === text || row.nameAr.trim().toLowerCase() === text,
    );
    if (exact) return { ok: true, category: exact, categories };
    const partial = categories.filter(
      (row) =>
        row.nameAr.toLowerCase().includes(text) ||
        (text.length >= 3 && text.includes(row.nameAr.toLowerCase())),
    );
    if (partial.length === 1) {
      return { ok: true, category: partial[0]!, categories };
    }
    if (partial.length > 1) {
      return {
        ok: false,
        result: {
          status: "needs_selection",
          field: options.field ?? "category",
          question: "أي قسم تقصدين؟",
          options: partial.map((row) => ({ id: row.code, label: row.nameAr })),
        },
      };
    }
    return {
      ok: false,
      result: rejected(
        "not_found",
        `ما لقيت قسماً باسم «${query.slice(0, 40)}». الأقسام: ${categories
          .map((row) => row.nameAr)
          .join("، ")}.`,
      ),
    };
  }

  async prepareProductCreation(
    actor: AdminActor,
    input: {
      attachmentIds?: string[];
      nameAr: string;
      latinName?: string;
      category: string;
      description?: string;
      unit?: string;
      attributes?: VariantAttributeInput;
      barcode?: string;
      sku?: string;
      priceIls?: string;
      state: PublicationState;
      acceptPlaceholder?: boolean;
      duplicateDecision?: "create_new";
      openingStock?: { quantity: string; unitCostIls: string };
    },
  ): Promise<PrepareResult> {
    const denied = this.ownerOnly(actor);
    if (denied) return denied;
    if (input.openingStock && !can(actor, "stock.adjust")) {
      return rejected("forbidden", "الرصيد الافتتاحي للمالك فقط.");
    }
    const nameAr = input.nameAr.trim();
    if (nameAr.length < 2) {
      return rejected("invalid_input", "اكتبي اسم المنتج بالعربي.");
    }
    if (!input.priceIls) {
      return rejected(
        "missing_price",
        "ما ذكرتِ سعر البيع، ولا أستطيع تخمينه. كم سعر بيع المنتج؟",
      );
    }
    const priceAgorot = parseIlsToAgorot(input.priceIls);
    if (!priceAgorot) {
      return moneyRejection(input.priceIls);
    }
    const problem =
      identifierProblem(input.sku, "SKU") ??
      identifierProblem(input.barcode, "الباركود");
    if (problem) return rejected("invalid_input", problem);
    const category = await this.resolveCategory(input.category);
    if (!category.ok) return category.result;

    const attachmentIds = [...new Set(input.attachmentIds ?? [])];
    for (const id of attachmentIds) {
      const attachment = await this.services.attachments.get(actor, id);
      if (!attachment || attachment.mimeType !== "image/jpeg") {
        return rejected(
          "attachment_missing",
          "إحدى الصور غير موجودة أو انتهت صلاحيتها. أعيدي إرفاقها.",
        );
      }
    }

    const clash = await this.services.authoring.identifierClash({
      sku: input.sku ?? null,
      barcode: input.barcode ?? null,
    });
    if (clash) {
      return rejected(
        clash,
        clash === "duplicate_sku"
          ? "رمز SKU مستخدم لمنتج آخر."
          : "الباركود مستخدم لمنتج آخر؛ غالباً المنتج موجود. ابحثي عنه بدل إضافته.",
      );
    }
    const attributes = toAttributes(input.attributes);
    const duplicates = await this.services.authoring.findDuplicates({
      nameAr,
      latinName: input.latinName ?? null,
      barcode: input.barcode ?? null,
      sku: input.sku ?? null,
      size: input.attributes?.size ?? input.attributes?.volume ?? null,
    });
    if (duplicates.length && input.duplicateDecision !== "create_new") {
      return {
        status: "needs_selection",
        field: "duplicateDecision",
        question:
          "لقيت منتجات مشابهة. هل هو واحد منها (عدّلي الموجود) أم منتج جديد؟",
        options: [
          ...duplicates.map((row) => ({
            id: row.productId,
            label: `الموجود: ${row.label} (${row.reasons.join("، ")})`,
          })),
          { id: "create_new", label: "منتج جديد مختلف" },
        ],
      };
    }

    let opening: { quantityMilli: number; unitCostAgorot: number } | null =
      null;
    if (input.openingStock) {
      const quantityMilli = parseQuantityToMilli(input.openingStock.quantity);
      const unitCostAgorot = parseIlsToAgorot(input.openingStock.unitCostIls);
      if (!quantityMilli || quantityMilli <= 0) {
        return rejected("invalid_input", "كمية الرصيد الافتتاحي غير مفهومة.");
      }
      if (!unitCostAgorot) {
        return rejected(
          "cost_required",
          "الرصيد الافتتاحي يحتاج تكلفة شراء الحبة. بكم اشتريتِها؟",
        );
      }
      opening = { quantityMilli, unitCostAgorot };
    }
    const fields = stateFields(input.state);
    if (
      fields.publication === "published" &&
      !attachmentIds.length &&
      !input.acceptPlaceholder
    ) {
      return rejected(
        "image_required",
        "النشر يحتاج صورة للمنتج. أرفقي صورة، أو قولي إنك موافقة على النشر بصورة افتراضية.",
      );
    }
    const variantLabel =
      attributes[attributeLabels.size] ??
      attributes[attributeLabels.volume] ??
      input.unit?.trim() ??
      "الافتراضي";
    const specifications = [
      input.latinName
        ? { labelAr: "العلامة التجارية", valueAr: input.latinName.trim() }
        : null,
      ...Object.entries(attributes).map(([labelAr, valueAr]) => ({
        labelAr,
        valueAr,
      })),
    ].filter((row): row is { labelAr: string; valueAr: string } =>
      Boolean(row),
    );

    const args = {
      attachmentIds,
      draft: {
        nameAr,
        latinName: input.latinName?.trim() || null,
        categoryCode: category.category.code,
        description: input.description?.trim() || null,
        unit: input.unit?.trim() || null,
        priceAgorot,
        ...fields,
        variantLabel,
        attributes,
        sku: input.sku?.trim() || null,
        barcode: input.barcode?.trim() || null,
        specifications,
        image: null,
        openingStock: opening,
      },
    };
    const rows: ConfirmationCard["rows"] = [
      { label: "الاسم", before: null, after: nameAr },
      ...(args.draft.latinName
        ? [
            {
              label: "الماركة/الاسم اللاتيني",
              before: null,
              after: args.draft.latinName,
            },
          ]
        : []),
      { label: "القسم", before: null, after: category.category.nameAr },
      { label: "سعر البيع", before: null, after: formatIls(priceAgorot) },
      { label: "الصنف", before: null, after: variantLabel },
      ...Object.entries(attributes).map(([label, value]) => ({
        label,
        before: null,
        after: value,
      })),
      ...(args.draft.barcode
        ? [{ label: "الباركود", before: null, after: args.draft.barcode }]
        : []),
      ...(args.draft.sku
        ? [{ label: "SKU", before: null, after: args.draft.sku }]
        : []),
      { label: "الحالة", before: null, after: publicationLabels[input.state] },
    ];
    const impact = [storefrontImpact[input.state]];
    if (opening) {
      rows.push(
        {
          label: "الرصيد الافتتاحي",
          before: null,
          after: formatQuantity(opening.quantityMilli),
        },
        {
          label: "تكلفة الحبة",
          before: null,
          after: formatIls(opening.unitCostAgorot),
        },
      );
      impact.push(
        `قيمة المخزون ستزيد ${formatIls(
          lineTotalAgorot(opening.quantityMilli, opening.unitCostAgorot),
        )} (حركة رصيد افتتاحي).`,
      );
    }
    const warnings: string[] = [];
    if (!attachmentIds.length)
      warnings.push("بدون صورة: ستُستخدم صورة افتراضية.");
    if (duplicates.length) {
      warnings.push(
        `اخترتِ إنشاء منتج جديد رغم وجود منتجات مشابهة: ${duplicates
          .map((row) => row.label)
          .join("، ")}.`,
      );
    }
    if (opening && opening.unitCostAgorot >= priceAgorot) {
      warnings.push("تكلفة الحبة أعلى من سعر البيع أو مساوية له.");
    }
    return {
      status: "ready",
      operation: opening ? "productCreateWithStock" : "productCreate",
      args,
      summary: `إضافة ${nameAr}`,
      card: {
        title: opening ? "إضافة منتج مع رصيد افتتاحي" : "إضافة منتج جديد",
        target: { label: nameAr, href: null },
        rows,
        impact,
        warnings,
        ...(attachmentIds[0]
          ? {
              images: {
                before: null,
                after: `/admin/api/assistant/attachments/${attachmentIds[0]}`,
              },
            }
          : {}),
        confirmLabel: "تأكيد الإضافة",
        destructive: false,
        reversible: true,
      },
    };
  }

  async prepareProductDetailsUpdate(
    actor: AdminActor,
    input: {
      product: string;
      changes: {
        slug?: string;
        sortOrder?: number;
        usageNotes?: string | null;
        imageAlt?: string;
      };
    },
  ): Promise<PrepareResult> {
    const denied = this.ownerOnly(actor);
    if (denied) return denied;
    const resolved = await this.services.resolveProduct(
      actor,
      input.product,
      "product",
      "product",
    );
    if (!resolved.ok) return resolved.result;
    const product = await this.services.catalog.getByDomainId(
      actor,
      resolved.product.id,
    );
    if (!product) return rejected("not_found", "المنتج غير موجود.");
    const changes: Record<string, unknown> = {};
    const rows: ConfirmationCard["rows"] = [];
    const warnings: string[] = [];
    if (input.changes.slug !== undefined) {
      const slug = input.changes.slug.trim().toLowerCase();
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 120) {
        return rejected(
          "invalid_input",
          "الرابط يجب أن يكون أحرفاً لاتينية صغيرة وأرقاماً وشرطات.",
        );
      }
      if (slug !== product.slug) {
        if (await this.services.authoring.slugTaken(slug, product.id)) {
          return rejected("duplicate_slug", "هذا الرابط مستخدم لمنتج آخر.");
        }
        changes.slug = slug;
        rows.push({ label: "رابط المنتج", before: product.slug, after: slug });
        warnings.push("الرابط القديم للمنتج لن يعمل بعد التغيير.");
      }
    }
    if (
      input.changes.sortOrder !== undefined &&
      input.changes.sortOrder !== product.sortOrder
    ) {
      changes.sortOrder = input.changes.sortOrder;
      rows.push({
        label: "الترتيب",
        before: String(product.sortOrder),
        after: String(input.changes.sortOrder),
      });
    }
    if (input.changes.usageNotes !== undefined) {
      const notes = input.changes.usageNotes?.trim() || null;
      if ((notes ?? "") !== (product.usageNotes ?? "")) {
        changes.usageNotes = notes;
        rows.push({
          label: "طريقة الاستخدام",
          before: product.usageNotes
            ? `${product.usageNotes.slice(0, 60)}…`
            : "—",
          after: notes ? `${notes.slice(0, 60)}…` : "—",
        });
      }
    }
    if (input.changes.imageAlt !== undefined) {
      if (product.image.kind !== "image") {
        return rejected(
          "invalid_input",
          "المنتج بدون صورة حقيقية، لا يوجد نص بديل لتعديله.",
        );
      }
      const alt = input.changes.imageAlt.trim();
      if (alt.length < 2 || alt.length > 250) {
        return rejected(
          "invalid_input",
          "النص البديل للصورة قصير أو طويل جداً.",
        );
      }
      if (alt !== product.image.alt) {
        changes.imageAlt = alt;
        rows.push({
          label: "وصف الصورة",
          before: product.image.alt,
          after: alt,
        });
      }
    }
    if (!rows.length) return rejected("no_change", "لا يوجد ما يتغيّر.");
    return {
      status: "ready",
      operation: "productDetails",
      args: { domainId: product.id, changes },
      summary: `تعديل تفاصيل ${product.nameAr}`,
      card: {
        title: "تعديل تفاصيل منتج",
        target: { label: product.nameAr, href: productHref(product.id) },
        rows,
        impact: [],
        warnings,
        confirmLabel: "تأكيد التعديل",
        destructive: false,
        reversible: true,
      },
    };
  }

  async prepareProductPublication(
    actor: AdminActor,
    input: {
      product: string;
      state: PublicationState;
      acceptPlaceholder?: boolean;
    },
  ): Promise<PrepareResult> {
    const denied = this.ownerOnly(actor);
    if (denied) return denied;
    const resolved = await this.services.resolveProduct(
      actor,
      input.product,
      "product",
      "product",
    );
    if (!resolved.ok) return resolved.result;
    const product = resolved.product;
    const current = publicationOf(product.publication, product.availability);
    if (current === input.state) {
      return rejected(
        "no_change",
        `المنتج أصلاً ${publicationLabels[current]}.`,
      );
    }
    const fields = stateFields(input.state);
    const warnings: string[] = [];
    if (fields.publication === "published") {
      const check = await this.services.authoring.publicationCheck(
        product.id,
        fields.availability,
      );
      if (!check) return rejected("not_found", "المنتج غير موجود.");
      if (!check.ready) {
        return rejected(
          "not_publishable",
          `لا يمكن النشر: ${check.problems.join(" ")}`,
        );
      }
      if (check.acceptedPlaceholder && !input.acceptPlaceholder) {
        return rejected(
          "image_required",
          "المنتج بدون صورة. أرفقي صورة أولاً، أو أكّدي أنك موافقة على النشر بالصورة الافتراضية.",
        );
      }
      if (check.acceptedPlaceholder)
        warnings.push("سيُنشر بالصورة الافتراضية.");
    }
    return {
      status: "ready",
      operation: "productPublication",
      args: {
        domainId: product.id,
        ...fields,
        acceptPlaceholder: Boolean(input.acceptPlaceholder),
      },
      summary: `${publicationLabels[input.state]}: ${product.nameAr}`,
      card: {
        title: "تغيير ظهور المنتج",
        target: { label: product.nameAr, href: productHref(product.id) },
        rows: [
          {
            label: "الحالة",
            before: publicationLabels[current],
            after: publicationLabels[input.state],
          },
        ],
        impact: [storefrontImpact[input.state]],
        warnings,
        confirmLabel: "تأكيد",
        destructive: false,
        reversible: true,
      },
    };
  }

  async prepareProductRestore(
    actor: AdminActor,
    input: { productId: string },
  ): Promise<PrepareResult> {
    const denied = this.ownerOnly(actor);
    if (denied) return denied;
    const product = await this.services.catalog.getByDomainId(
      actor,
      input.productId,
    );
    if (!product || !product.archived) {
      return rejected("not_found", "ما لقيت منتجاً مؤرشفاً بهذا المعرّف.");
    }
    return {
      status: "ready",
      operation: "productRestore",
      args: { domainId: product.id },
      summary: `استرجاع ${product.nameAr}`,
      card: {
        title: "استرجاع منتج مؤرشف",
        target: { label: product.nameAr, href: productHref(product.id) },
        rows: [
          { label: "الحالة", before: "مؤرشف", after: publicationLabels.hidden },
        ],
        impact: ["سيعود المنتج للوحة الإدارة مخفياً؛ انشريه لاحقاً إذا أردتِ."],
        warnings: [],
        confirmLabel: "تأكيد الاسترجاع",
        destructive: false,
        reversible: true,
      },
    };
  }

  async prepareProductImageRemoval(
    actor: AdminActor,
    input: { product: string },
  ): Promise<PrepareResult> {
    const denied = this.ownerOnly(actor);
    if (denied) return denied;
    const resolved = await this.services.resolveProduct(
      actor,
      input.product,
      "product",
      "product",
    );
    if (!resolved.ok) return resolved.result;
    const product = resolved.product;
    if (product.image.kind !== "image") {
      return rejected("no_change", "المنتج أصلاً بدون صورة.");
    }
    const warnings =
      product.publication === "published"
        ? ["المنتج منشور؛ سيظهر بالصورة الافتراضية في المتجر."]
        : [];
    return {
      status: "ready",
      operation: "productImageRemoval",
      args: { domainId: product.id },
      summary: `إزالة صورة ${product.nameAr}`,
      card: {
        title: "إزالة صورة المنتج",
        target: { label: product.nameAr, href: productHref(product.id) },
        rows: [
          { label: "الصورة", before: "صورة حقيقية", after: "صورة افتراضية" },
        ],
        impact: ["ملف الصورة يبقى محفوظاً في التخزين ويمكن إعادة رفعه."],
        warnings,
        confirmLabel: "تأكيد الإزالة",
        destructive: false,
        reversible: true,
      },
    };
  }

  async prepareUnusedProductDeletion(
    actor: AdminActor,
    input: { product: string; reason: string },
    references: (domainId: string) => Promise<{
      orders: number;
      purchases: number;
      sales: number;
      stockMovements: number;
    } | null>,
  ): Promise<PrepareResult> {
    const denied = this.ownerOnly(actor);
    if (denied) return denied;
    const resolved = await this.services.resolveProduct(
      actor,
      input.product,
      "product",
      "product",
    );
    if (!resolved.ok) return resolved.result;
    const product = resolved.product;
    const refs = await references(product.id);
    if (!refs) return rejected("not_found", "المنتج غير موجود.");
    const total =
      refs.orders + refs.purchases + refs.sales + refs.stockMovements;
    if (total > 0) {
      return rejected(
        "in_use",
        `لا يمكن حذف «${product.nameAr}» نهائياً لأنه مرتبط بسجلات (طلبات ${refs.orders}، مشتريات ${refs.purchases}، مبيعات ${refs.sales}، حركات مخزون ${refs.stockMovements}). يمكن أرشفته بدلاً من ذلك.`,
      );
    }
    return {
      status: "ready",
      operation: "productDelete",
      args: { domainId: product.id, reason: input.reason.trim().slice(0, 200) },
      summary: `حذف ${product.nameAr} نهائياً`,
      card: {
        title: "حذف منتج نهائياً",
        target: { label: product.nameAr, href: productHref(product.id) },
        rows: [
          {
            label: "السبب",
            before: null,
            after: input.reason.trim().slice(0, 200) || "—",
          },
        ],
        impact: ["سيُحذف المنتج وأصنافه ومواصفاته من قاعدة البيانات."],
        warnings: ["لا يمكن التراجع عن الحذف النهائي."],
        dependencies: ["طلبات 0", "مشتريات 0", "مبيعات 0", "حركات مخزون 0"],
        confirmLabel: "حذف نهائي",
        destructive: true,
        reversible: false,
      },
    };
  }

  private async variantFor(actor: AdminActor, query: string, field: string) {
    const resolved = await this.services.resolveVariant(actor, query, field);
    if (!resolved.ok) return resolved;
    const variant = resolved.product.variants.find(
      (row) => row.id === resolved.match.variantId,
    );
    if (!variant) {
      return {
        ok: false as const,
        result: rejected("not_found", "الصنف غير موجود."),
      };
    }
    return { ok: true as const, product: resolved.product, variant };
  }

  async prepareVariantCreation(
    actor: AdminActor,
    input: {
      product: string;
      label: string;
      attributes?: VariantAttributeInput;
      priceIls: string;
      sku?: string;
      barcode?: string;
      available?: boolean;
    },
  ): Promise<PrepareResult> {
    const denied = this.ownerOnly(actor);
    if (denied) return denied;
    const resolved = await this.services.resolveProduct(
      actor,
      input.product,
      "product",
      "product",
    );
    if (!resolved.ok) return resolved.result;
    const product = resolved.product;
    // A free-text variant on a product with options would have no option values and break its combinations.
    if (await this.services.hasOptions(product.id)) {
      return rejected(
        "has_options",
        "هذا المنتج أصنافه حسب خيارات (لون، رائحة، حجم). أضيفي قيمة الخيار ثم الأصناف الناقصة بدل صنف حر.",
      );
    }
    const priceAgorot = parseIlsToAgorot(input.priceIls);
    if (!priceAgorot) return moneyRejection(input.priceIls);
    const problem =
      identifierProblem(input.sku, "SKU") ??
      identifierProblem(input.barcode, "الباركود");
    if (problem) return rejected("invalid_input", problem);
    const label = input.label.trim();
    if (!label)
      return rejected("invalid_input", "اكتبي اسم الصنف، مثل «2 لتر».");
    const attributes = toAttributes(input.attributes);
    const sameLabel = product.variants.find(
      (row) => row.labelAr.trim() === label,
    );
    if (sameLabel) {
      return rejected(
        "duplicate_variant",
        `يوجد صنف «${sameLabel.labelAr}» لهذا المنتج. عدّليه بدل إضافة صنف مكرر.`,
      );
    }
    const clash = await this.services.authoring.identifierClash({
      sku: input.sku ?? null,
      barcode: input.barcode ?? null,
    });
    if (clash) {
      return rejected(
        clash,
        clash === "duplicate_sku"
          ? "رمز SKU مستخدم."
          : "الباركود مستخدم لصنف آخر.",
      );
    }
    const availability =
      input.available === false ? "unavailable" : "available";
    return {
      status: "ready",
      operation: "variantCreate",
      args: {
        productDomainId: product.id,
        variant: {
          labelAr: label,
          attributes,
          priceAgorot,
          availability,
          sku: input.sku?.trim() || null,
          barcode: input.barcode?.trim() || null,
        },
      },
      summary: `إضافة صنف ${label} إلى ${product.nameAr}`,
      card: {
        title: "إضافة صنف",
        target: { label: product.nameAr, href: productHref(product.id) },
        rows: [
          { label: "الصنف", before: null, after: label },
          { label: "السعر", before: null, after: formatIls(priceAgorot) },
          {
            label: "الحالة",
            before: null,
            after: availabilityLabel(availability),
          },
          ...Object.entries(attributes).map(([key, value]) => ({
            label: key,
            before: null,
            after: value,
          })),
          ...(input.sku
            ? [{ label: "SKU", before: null, after: input.sku }]
            : []),
          ...(input.barcode
            ? [{ label: "الباركود", before: null, after: input.barcode }]
            : []),
        ],
        impact:
          product.publication === "published"
            ? ["سيظهر الصنف للزبائن في صفحة المنتج."]
            : ["المنتج غير منشور؛ لن يظهر الصنف في المتجر حتى النشر."],
        warnings: [],
        confirmLabel: "تأكيد الإضافة",
        destructive: false,
        reversible: true,
      },
    };
  }

  async prepareVariantUpdate(
    actor: AdminActor,
    input: {
      variant: string;
      changes: {
        label?: string;
        attributes?: VariantAttributeInput;
        priceIls?: string;
        available?: boolean;
        sku?: string | null;
        barcode?: string | null;
      };
    },
  ): Promise<PrepareResult> {
    const denied = this.ownerOnly(actor);
    if (denied) return denied;
    const found = await this.variantFor(actor, input.variant, "variant");
    if (!found.ok) return found.result;
    const { product, variant } = found;
    const changes: Record<string, unknown> = {};
    const rows: ConfirmationCard["rows"] = [];
    const warnings: string[] = [];
    const { changes: requested } = input;
    if (
      requested.label !== undefined &&
      requested.label.trim() &&
      requested.label.trim() !== variant.labelAr
    ) {
      changes.labelAr = requested.label.trim();
      rows.push({
        label: "اسم الصنف",
        before: variant.labelAr,
        after: requested.label.trim(),
      });
    }
    if (requested.attributes) {
      const next = {
        ...variant.attributes,
        ...toAttributes(requested.attributes),
      };
      if (canonicalJson(next) !== canonicalJson(variant.attributes)) {
        changes.attributes = next;
        rows.push({
          label: "الخصائص",
          before:
            Object.entries(variant.attributes)
              .map(([k, v]) => `${k}: ${v}`)
              .join("، ") || "—",
          after: Object.entries(next)
            .map(([k, v]) => `${k}: ${v}`)
            .join("، "),
        });
      }
    }
    if (requested.priceIls !== undefined) {
      const price = parseIlsToAgorot(requested.priceIls);
      if (!price) return moneyRejection(requested.priceIls);
      if (price !== variant.priceAgorot) {
        changes.priceAgorot = price;
        rows.push({
          label: "السعر",
          before: formatIls(variant.priceAgorot),
          after: formatIls(price),
        });
        warnings.push(
          "السعر الجديد يطبّق على الطلبات القادمة فقط؛ الطلبات والفواتير السابقة لا تتغيّر.",
        );
      }
    }
    if (requested.available !== undefined) {
      const availability = requested.available ? "available" : "unavailable";
      if (availability !== variant.availability) {
        changes.availability = availability;
        rows.push({
          label: "الحالة",
          before: availabilityLabel(variant.availability),
          after: availabilityLabel(availability),
        });
      }
    }
    for (const key of ["sku", "barcode"] as const) {
      const value = requested[key];
      if (value === undefined) continue;
      const clean = value?.trim() || null;
      const problem = identifierProblem(
        clean,
        key === "sku" ? "SKU" : "الباركود",
      );
      if (problem) return rejected("invalid_input", problem);
      if (clean !== (variant[key] ?? null)) {
        changes[key] = clean;
        rows.push({
          label: key === "sku" ? "SKU" : "الباركود",
          before: variant[key] ?? "—",
          after: clean ?? "—",
        });
      }
    }
    if (!rows.length) return rejected("no_change", "لا يوجد ما يتغيّر.");
    if (changes.sku !== undefined || changes.barcode !== undefined) {
      const clash = await this.services.authoring.identifierClash({
        sku: (changes.sku as string | null | undefined) ?? null,
        barcode: (changes.barcode as string | null | undefined) ?? null,
        exceptVariantId: variant.id,
      });
      if (clash)
        return rejected(
          clash,
          clash === "duplicate_sku"
            ? "رمز SKU مستخدم."
            : "الباركود مستخدم لصنف آخر.",
        );
    }
    const label =
      product.variants.length > 1
        ? `${product.nameAr} — ${variant.labelAr}`
        : product.nameAr;
    return {
      status: "ready",
      operation: "variantUpdate",
      args: { variantId: variant.id, changes },
      summary: `تعديل ${label}`,
      card: {
        title: "تعديل صنف",
        target: { label, href: productHref(product.id) },
        rows,
        impact:
          variant.isDefault && changes.priceAgorot !== undefined
            ? ["هذا الصنف الافتراضي؛ سعر المنتج في المتجر سيتغيّر أيضاً."]
            : [],
        warnings,
        confirmLabel: "تأكيد التعديل",
        destructive: false,
        reversible: true,
      },
    };
  }

  async prepareDefaultVariant(
    actor: AdminActor,
    input: { variant: string },
  ): Promise<PrepareResult> {
    const denied = this.ownerOnly(actor);
    if (denied) return denied;
    const found = await this.variantFor(actor, input.variant, "variant");
    if (!found.ok) return found.result;
    const { product, variant } = found;
    if (variant.isDefault)
      return rejected("no_change", "هذا هو الصنف الافتراضي أصلاً.");
    const current = product.variants.find((row) => row.isDefault);
    return {
      status: "ready",
      operation: "variantDefault",
      args: { variantId: variant.id },
      summary: `جعل ${variant.labelAr} الصنف الافتراضي`,
      card: {
        title: "تغيير الصنف الافتراضي",
        target: { label: product.nameAr, href: productHref(product.id) },
        rows: [
          {
            label: "الصنف الافتراضي",
            before: current?.labelAr ?? "—",
            after: variant.labelAr,
          },
          {
            label: "سعر المنتج المعروض",
            before: formatIls(product.priceAgorot),
            after: formatIls(variant.priceAgorot),
          },
        ],
        impact: ["سعر وصورة المنتج في قائمة المتجر سيتبعان الصنف الجديد."],
        warnings: [],
        confirmLabel: "تأكيد",
        destructive: false,
        reversible: true,
      },
    };
  }

  async prepareVariantImage(
    actor: AdminActor,
    input: { variant: string; attachmentId: string },
  ): Promise<PrepareResult> {
    const denied = this.ownerOnly(actor);
    if (denied) return denied;
    const found = await this.variantFor(actor, input.variant, "variant");
    if (!found.ok) return found.result;
    const attachment = await this.services.attachments.get(
      actor,
      input.attachmentId,
    );
    if (!attachment || attachment.mimeType !== "image/jpeg") {
      return rejected("attachment_missing", "أرفقي صورة الصنف أولاً.");
    }
    const { product, variant } = found;
    return {
      status: "ready",
      operation: "variantImage",
      args: {
        variantId: variant.id,
        attachmentId: attachment.id,
        alt: `${product.nameAr} ${variant.labelAr}`.slice(0, 250),
      },
      summary: `صورة ${variant.labelAr}`,
      card: {
        title: "تغيير صورة صنف",
        target: {
          label: `${product.nameAr} — ${variant.labelAr}`,
          href: productHref(product.id),
        },
        rows: [],
        impact: variant.isDefault
          ? ["هذا الصنف الافتراضي؛ ستتغيّر صورة المنتج في المتجر."]
          : [],
        warnings: [],
        images: {
          before: variant.image.kind === "image" ? variant.image.src : null,
          after: `/admin/api/assistant/attachments/${attachment.id}`,
        },
        confirmLabel: "تأكيد الصورة",
        destructive: false,
        reversible: true,
      },
    };
  }

  async prepareVariantArchive(
    actor: AdminActor,
    input: { variant: string; mode: "archive" | "restore" },
  ): Promise<PrepareResult> {
    const denied = this.ownerOnly(actor);
    if (denied) return denied;
    if (input.mode === "restore") {
      let target = await this.services.authoring.archivedVariant(input.variant);
      if (!target) {
        // Not an id: resolve the spoken name against archived variants only.
        const archived = await this.services.authoring.allArchivedVariants();
        const resolution = forChanges(
          resolveCatalogEntity(
            input.variant,
            archived.map((row) => ({
              productId: row.productId,
              variantId: row.variantId,
              nameAr: row.nameAr,
              latinName: row.latinName,
              variantLabel: row.labelAr,
              sku: row.sku,
              barcode: row.barcode,
            })),
            "variant",
          ),
        );
        if (resolution.status === "ambiguous") {
          return {
            status: "needs_selection",
            field: "variant",
            question: selectionQuestion(
              resolution.candidates,
              input.variant,
              "variant",
            ),
            options: resolution.candidates.map((item) => ({
              id: item.variantId,
              label: item.label,
            })),
          };
        }
        if (resolution.status === "resolved") {
          target = await this.services.authoring.archivedVariant(
            resolution.match.variantId,
          );
        }
      }
      if (!target)
        return rejected(
          "not_found",
          `ما لقيت صنفاً مؤرشفاً باسم «${input.variant.slice(0, 60)}».`,
        );
      return {
        status: "ready",
        operation: "variantRestore",
        args: { variantId: target.variantId },
        summary: `استرجاع ${target.label}`,
        card: {
          title: "استرجاع صنف مؤرشف",
          target: { label: target.label, href: productHref(target.productId) },
          rows: [
            {
              label: "الحالة",
              before: "مؤرشف",
              after: availabilityLabel(target.availability),
            },
          ],
          impact: ["سيظهر الصنف مرة أخرى في صفحة المنتج."],
          warnings: [],
          confirmLabel: "تأكيد الاسترجاع",
          destructive: false,
          reversible: true,
        },
      };
    }
    const found = await this.variantFor(actor, input.variant, "variant");
    if (!found.ok) return found.result;
    const { product, variant } = found;
    if (variant.isDefault) {
      return rejected(
        "default_variant",
        "لا يمكن أرشفة الصنف الافتراضي؛ اختاري صنفاً افتراضياً آخر أولاً.",
      );
    }
    const refs = await this.services.authoring.variantReferences(variant.id);
    if (!refs) return rejected("not_found", "الصنف غير موجود.");
    if (refs.onHandMilli !== 0) {
      return rejected(
        "stock_on_hand",
        `لهذا الصنف كمية ${formatQuantity(refs.onHandMilli)} في المخزون. انقليها أو صحّحي المخزون قبل الأرشفة.`,
      );
    }
    return {
      status: "ready",
      operation: "variantArchive",
      args: { variantId: variant.id },
      summary: `أرشفة ${variant.labelAr}`,
      card: {
        title: "أرشفة صنف",
        target: {
          label: `${product.nameAr} — ${variant.labelAr}`,
          href: productHref(product.id),
        },
        rows: [
          {
            label: "السجلات المرتبطة",
            before: null,
            after: `طلبات ${refs.orders} · مشتريات ${refs.purchases} · مبيعات ${refs.sales} · حركات مخزون ${refs.stockMovements}`,
          },
        ],
        impact: [
          "يختفي الصنف من المتجر والقوائم، ويبقى تاريخه وسجلاته كما هي.",
        ],
        warnings: [],
        confirmLabel: "تأكيد الأرشفة",
        destructive: false,
        reversible: true,
      },
    };
  }

  async prepareUnusedVariantDeletion(
    actor: AdminActor,
    input: { variant: string },
  ): Promise<PrepareResult> {
    const denied = this.ownerOnly(actor);
    if (denied) return denied;
    const found = await this.variantFor(actor, input.variant, "variant");
    if (!found.ok) return found.result;
    const { product, variant } = found;
    if (variant.isDefault)
      return rejected("default_variant", "لا يمكن حذف الصنف الافتراضي.");
    const refs = await this.services.authoring.variantReferences(variant.id);
    if (!refs) return rejected("not_found", "الصنف غير موجود.");
    const total =
      refs.orders + refs.purchases + refs.sales + refs.stockMovements;
    if (total > 0 || refs.onHandMilli !== 0) {
      return rejected(
        "in_use",
        `الصنف مرتبط بسجلات تاريخية (${total}) أو له مخزون، لذلك لا يُحذف نهائياً. يمكن أرشفته.`,
      );
    }
    return {
      status: "ready",
      operation: "variantDelete",
      args: { variantId: variant.id },
      summary: `حذف ${variant.labelAr} نهائياً`,
      card: {
        title: "حذف صنف نهائياً",
        target: {
          label: `${product.nameAr} — ${variant.labelAr}`,
          href: productHref(product.id),
        },
        rows: [{ label: "الصنف", before: variant.labelAr, after: "يُحذف" }],
        impact: [
          "لا توجد طلبات أو مشتريات أو مبيعات أو حركات مخزون لهذا الصنف.",
        ],
        warnings: ["لا يمكن التراجع عن الحذف النهائي."],
        dependencies: ["طلبات 0", "مشتريات 0", "مبيعات 0", "حركات مخزون 0"],
        confirmLabel: "حذف نهائي",
        destructive: true,
        reversible: false,
      },
    };
  }

  async prepareSpecification(
    actor: AdminActor,
    input: { product: string; label: string; value: string | null },
  ): Promise<PrepareResult> {
    const denied = this.ownerOnly(actor);
    if (denied) return denied;
    const resolved = await this.services.resolveProduct(
      actor,
      input.product,
      "product",
      "product",
    );
    if (!resolved.ok) return resolved.result;
    const product = resolved.product;
    const label = input.label.trim().slice(0, 80);
    if (!label) return rejected("invalid_input", "اكتبي اسم المواصفة.");
    const existing = product.specifications.find(
      (row) => row.labelAr.trim() === label,
    );
    if (input.value === null) {
      if (!existing) return rejected("not_found", `لا توجد مواصفة «${label}».`);
      return {
        status: "ready",
        operation: "specificationRemove",
        args: { productDomainId: product.id, specificationId: existing.id },
        summary: `حذف مواصفة ${label}`,
        card: {
          title: "حذف مواصفة",
          target: { label: product.nameAr, href: productHref(product.id) },
          rows: [{ label, before: existing.valueAr, after: "—" }],
          impact: [],
          warnings: [],
          confirmLabel: "تأكيد",
          destructive: false,
          reversible: true,
        },
      };
    }
    const value = input.value.trim().slice(0, 200);
    if (!value) return rejected("invalid_input", "اكتبي قيمة المواصفة.");
    if (existing?.valueAr === value)
      return rejected("no_change", "القيمة نفسها.");
    return {
      status: "ready",
      operation: "specificationUpsert",
      args: {
        productDomainId: product.id,
        specificationId: existing?.id,
        labelAr: label,
        valueAr: value,
        sortOrder: existing?.sortOrder ?? product.specifications.length,
      },
      summary: `مواصفة ${label}`,
      card: {
        title: existing ? "تعديل مواصفة" : "إضافة مواصفة",
        target: { label: product.nameAr, href: productHref(product.id) },
        rows: [{ label, before: existing?.valueAr ?? null, after: value }],
        impact: [],
        warnings: [],
        confirmLabel: "تأكيد",
        destructive: false,
        reversible: true,
      },
    };
  }

  async prepareCategoryCreation(
    actor: AdminActor,
    input: {
      nameAr: string;
      description?: string;
      icon: CategoryIconKey;
      visible?: boolean;
      code?: string;
    },
  ): Promise<PrepareResult> {
    const denied = this.ownerOnly(actor);
    if (denied) return denied;
    const nameAr = input.nameAr.trim();
    if (nameAr.length < 2 || nameAr.length > 80)
      return rejected("invalid_input", "اسم القسم غير صالح.");
    if (await this.services.authoring.categoryNameTaken(nameAr)) {
      return rejected("duplicate_category", "يوجد قسم بنفس الاسم.");
    }
    const categories = await this.services.authoring.listCategories(true);
    const taken = new Set(categories.map((row) => row.code));
    const code = input.code
      ? input.code.trim().toLowerCase()
      : categoryCodeFrom(nameAr, taken);
    if (!categoryCodeSchema.safeParse(code).success || taken.has(code)) {
      return rejected(
        "invalid_input",
        "رمز القسم يجب أن يكون فريداً بأحرف لاتينية صغيرة وأرقام، مثل air-fresheners.",
      );
    }
    const visible = input.visible ?? true;
    return {
      status: "ready",
      operation: "categoryCreate",
      args: {
        code,
        nameAr,
        description: input.description?.trim() || null,
        icon: input.icon,
        visible,
      },
      summary: `إضافة قسم ${nameAr}`,
      card: {
        title: "إضافة قسم",
        target: { label: nameAr, href: categoriesHref },
        rows: [
          { label: "الاسم", before: null, after: nameAr },
          { label: "الرمز", before: null, after: code },
          {
            label: "الأيقونة",
            before: null,
            after: categoryIconLabels[input.icon],
          },
          {
            label: "الظهور",
            before: null,
            after: visible ? "ظاهر في المتجر" : "مخفي",
          },
        ],
        impact: visible ? ["سيظهر القسم في شريط الأقسام في المتجر."] : [],
        warnings: [],
        confirmLabel: "تأكيد الإضافة",
        destructive: false,
        reversible: true,
      },
    };
  }

  async prepareCategoryUpdate(
    actor: AdminActor,
    input: {
      category: string;
      changes: {
        nameAr?: string;
        description?: string | null;
        icon?: CategoryIconKey;
        visible?: boolean;
        sortOrder?: number;
      };
    },
  ): Promise<PrepareResult> {
    const denied = this.ownerOnly(actor);
    if (denied) return denied;
    const resolved = await this.resolveCategory(input.category);
    if (!resolved.ok) return resolved.result;
    const { category } = resolved;
    const changes: Record<string, unknown> = {};
    const rows: ConfirmationCard["rows"] = [];
    const { changes: requested } = input;
    if (
      requested.nameAr !== undefined &&
      requested.nameAr.trim() !== category.nameAr
    ) {
      const name = requested.nameAr.trim();
      if (name.length < 2 || name.length > 80)
        return rejected("invalid_input", "اسم القسم غير صالح.");
      if (
        await this.services.authoring.categoryNameTaken(name, category.code)
      ) {
        return rejected("duplicate_category", "يوجد قسم بنفس الاسم.");
      }
      changes.nameAr = name;
      rows.push({ label: "الاسم", before: category.nameAr, after: name });
    }
    if (requested.description !== undefined) {
      const description = requested.description?.trim() || null;
      if (description !== category.description) {
        changes.description = description;
        rows.push({
          label: "الوصف",
          before: category.description ?? "—",
          after: description ?? "—",
        });
      }
    }
    if (requested.icon !== undefined && requested.icon !== category.icon) {
      changes.icon = requested.icon;
      rows.push({
        label: "الأيقونة",
        before: categoryIconLabels[category.icon],
        after: categoryIconLabels[requested.icon],
      });
    }
    if (
      requested.visible !== undefined &&
      requested.visible !== category.visible
    ) {
      changes.visible = requested.visible;
      rows.push({
        label: "الظهور",
        before: category.visible ? "ظاهر" : "مخفي",
        after: requested.visible ? "ظاهر" : "مخفي",
      });
    }
    if (
      requested.sortOrder !== undefined &&
      requested.sortOrder !== category.sortOrder
    ) {
      changes.sortOrder = requested.sortOrder;
      rows.push({
        label: "الترتيب",
        before: String(category.sortOrder),
        after: String(requested.sortOrder),
      });
    }
    if (!rows.length) return rejected("no_change", "لا يوجد ما يتغيّر.");
    return {
      status: "ready",
      operation: "categoryUpdate",
      args: { code: category.code, changes },
      summary: `تعديل قسم ${category.nameAr}`,
      card: {
        title: "تعديل قسم",
        target: { label: category.nameAr, href: categoriesHref },
        rows,
        impact:
          changes.visible === false
            ? [
                `سيختفي القسم من شريط الأقسام؛ منتجاته (${category.productCount}) تبقى ظاهرة ضمن «الكل».`,
              ]
            : [],
        warnings: [],
        confirmLabel: "تأكيد التعديل",
        destructive: false,
        reversible: true,
      },
    };
  }

  async prepareCategoryArchive(
    actor: AdminActor,
    input: { category: string; mode: "archive" | "restore" },
  ): Promise<PrepareResult> {
    const denied = this.ownerOnly(actor);
    if (denied) return denied;
    const resolved = await this.resolveCategory(input.category, {
      includeArchived: input.mode === "restore",
    });
    if (!resolved.ok) return resolved.result;
    const { category } = resolved;
    if (input.mode === "restore") {
      if (!category.archived) return rejected("no_change", "القسم غير مؤرشف.");
      if (category.mergedIntoCode) {
        return rejected(
          "invalid_input",
          "هذا القسم دُمج في قسم آخر ولا يُسترجع.",
        );
      }
      return {
        status: "ready",
        operation: "categoryRestore",
        args: { code: category.code },
        summary: `استرجاع قسم ${category.nameAr}`,
        card: {
          title: "استرجاع قسم",
          target: { label: category.nameAr, href: categoriesHref },
          rows: [{ label: "الحالة", before: "مؤرشف", after: "نشط لكن مخفي" }],
          impact: ["يعود القسم مخفياً؛ أظهريه لاحقاً إذا أردتِ."],
          warnings: [],
          confirmLabel: "تأكيد الاسترجاع",
          destructive: false,
          reversible: true,
        },
      };
    }
    if (category.productCount > 0) {
      return rejected(
        "category_not_empty",
        `في القسم ${category.productCount} منتج. انقليها لقسم آخر أو ادمجي القسم قبل الأرشفة.`,
      );
    }
    return {
      status: "ready",
      operation: "categoryArchive",
      args: { code: category.code },
      summary: `أرشفة قسم ${category.nameAr}`,
      card: {
        title: "أرشفة قسم",
        target: { label: category.nameAr, href: categoriesHref },
        rows: [{ label: "عدد المنتجات", before: null, after: "0" }],
        impact: ["سيختفي القسم من المتجر ولوحة الإدارة، ويمكن استرجاعه."],
        warnings: [],
        confirmLabel: "تأكيد الأرشفة",
        destructive: false,
        reversible: true,
      },
    };
  }

  async prepareCategoryMerge(
    actor: AdminActor,
    input: { source: string; target: string },
  ): Promise<PrepareResult> {
    const denied = this.ownerOnly(actor);
    if (denied) return denied;
    const source = await this.resolveCategory(input.source, {
      field: "source",
    });
    if (!source.ok) return source.result;
    const target = await this.resolveCategory(input.target, {
      field: "target",
    });
    if (!target.ok) return target.result;
    if (source.category.code === target.category.code) {
      return rejected("invalid_input", "القسمان متطابقان.");
    }
    return {
      status: "ready",
      operation: "categoryMerge",
      args: {
        sourceCode: source.category.code,
        targetCode: target.category.code,
      },
      summary: `دمج ${source.category.nameAr} في ${target.category.nameAr}`,
      card: {
        title: "دمج قسمين",
        target: {
          label: `${source.category.nameAr} ← ${target.category.nameAr}`,
          href: categoriesHref,
        },
        rows: [
          {
            label: "المنتجات المنقولة",
            before: null,
            after: String(source.category.productCount),
          },
          {
            label: "القسم المدموج",
            before: source.category.nameAr,
            after: "مؤرشف ومربوط بالقسم الهدف",
          },
        ],
        impact: [
          `${source.category.productCount} منتج سينتقل إلى «${target.category.nameAr}» ويظهر تحته في المتجر.`,
        ],
        warnings: ["الدمج لا يُلغى تلقائياً؛ يمكن نقل المنتجات يدوياً لاحقاً."],
        confirmLabel: "تأكيد الدمج",
        destructive: true,
        reversible: false,
      },
    };
  }

  async prepareProductsCategoryMove(
    actor: AdminActor,
    input: { products: string[]; category: string },
  ): Promise<PrepareResult> {
    const denied = this.ownerOnly(actor);
    if (denied) return denied;
    const target = await this.resolveCategory(input.category);
    if (!target.ok) return target.result;
    const ids: string[] = [];
    const names: string[] = [];
    for (const query of input.products) {
      const resolved = await this.services.resolveProduct(
        actor,
        query,
        "product",
        "products",
      );
      if (!resolved.ok) return resolved.result;
      if (resolved.product.categoryId === target.category.code) continue;
      ids.push(resolved.product.id);
      names.push(resolved.product.nameAr);
    }
    if (!ids.length)
      return rejected("no_change", "المنتجات أصلاً في هذا القسم.");
    return {
      status: "ready",
      operation: "categoryMove",
      args: { productDomainIds: ids, targetCode: target.category.code },
      summary: `نقل ${ids.length} منتج إلى ${target.category.nameAr}`,
      card: {
        title: "نقل منتجات إلى قسم",
        target: { label: target.category.nameAr, href: categoriesHref },
        rows: names.map((name) => ({
          label: name,
          before: null,
          after: target.category.nameAr,
        })),
        impact: [
          `${ids.length} منتج سيظهر تحت «${target.category.nameAr}» في المتجر.`,
        ],
        warnings: [],
        confirmLabel: "تأكيد النقل",
        destructive: false,
        reversible: true,
      },
    };
  }

  async prepareEmptyCategoryDeletion(
    actor: AdminActor,
    input: { category: string },
  ): Promise<PrepareResult> {
    const denied = this.ownerOnly(actor);
    if (denied) return denied;
    const resolved = await this.resolveCategory(input.category, {
      includeArchived: true,
    });
    if (!resolved.ok) return resolved.result;
    const { category } = resolved;
    const usage = await this.services.authoring.categoryUsage(category.code);
    if (!usage) return rejected("not_found", "القسم غير موجود.");
    if (usage.total > 0) {
      return rejected(
        "category_not_empty",
        `القسم مرتبط بـ ${usage.total} منتج (منها مؤرشفة)، لذلك لا يُحذف نهائياً. يمكن أرشفته.`,
      );
    }
    return {
      status: "ready",
      operation: "categoryDelete",
      args: { code: category.code },
      summary: `حذف قسم ${category.nameAr} نهائياً`,
      card: {
        title: "حذف قسم نهائياً",
        target: { label: category.nameAr, href: categoriesHref },
        rows: [{ label: "القسم", before: category.nameAr, after: "يُحذف" }],
        impact: ["لا توجد منتجات مرتبطة بهذا القسم."],
        warnings: ["لا يمكن التراجع عن الحذف النهائي."],
        dependencies: ["منتجات 0"],
        confirmLabel: "حذف نهائي",
        destructive: true,
        reversible: false,
      },
    };
  }

  buildHandlers(
    deleteProduct: (actor: AdminActor, domainId: string) => Promise<void>,
  ): Record<CatalogOperation, Handler<never>> {
    const { authoring, catalog } = this.services;
    const services = this.services;
    const done = (
      message: string,
      href: string | null,
      ref: string,
    ): ExecutionResult => ({
      message,
      href,
      ref,
    });
    const productVersion = (_actor: AdminActor, args: { domainId: string }) =>
      authoring.productVersion(args.domainId);
    const variantVersion = (_actor: AdminActor, args: { variantId: string }) =>
      authoring.variantVersion(args.variantId);
    const categoryVersion = (_actor: AdminActor, args: { code: string }) =>
      authoring.categoryVersion(args.code);

    const createArgs = z.object({
      attachmentIds: z.array(z.uuid()).max(6),
      draft: z.record(z.string(), z.unknown()),
    });
    const createVersion = async (
      actor: AdminActor,
      args: z.infer<typeof createArgs>,
    ) => {
      const draft = args.draft as {
        sku: string | null;
        barcode: string | null;
        categoryCode: string;
      };
      const [clash, category] = await Promise.all([
        authoring.identifierClash({ sku: draft.sku, barcode: draft.barcode }),
        authoring.categoryVersion(draft.categoryCode),
      ]);
      for (const id of args.attachmentIds) {
        if (!(await services.attachments.get(actor, id))) return null;
      }
      if (clash || !category) return null;
      return sha256(
        canonicalJson({ category, attachments: args.attachmentIds }),
      );
    };
    const create = async (
      actor: AdminActor,
      args: z.infer<typeof createArgs>,
      key: string,
    ): Promise<ExecutionResult> => {
      const draft = args.draft as Parameters<
        CatalogAuthoringService["createProduct"]
      >[1];
      let image = null;
      if (args.attachmentIds[0]) {
        const stored = await storeAttachmentImage(
          services,
          actor,
          args.attachmentIds[0],
        );
        image = { ...stored, alt: `صورة ${draft.nameAr}`.slice(0, 250) };
      }
      const result = await authoring.createProduct(
        actor,
        { ...draft, image },
        key,
      );
      return done(
        result.replayed
          ? "المنتج مضاف سابقاً بهذه العملية."
          : `تمت إضافة ${draft.nameAr}.`,
        productHref(result.domainId),
        `product:${result.domainId}`,
      );
    };

    const handlers = {
      productCreate: {
        args: createArgs,
        version: createVersion,
        execute: create,
      },
      productCreateWithStock: {
        args: createArgs,
        version: createVersion,
        execute: create,
      },
      productDetails: {
        args: z.object({
          domainId: z.string(),
          changes: z.record(z.string(), z.unknown()),
        }),
        version: productVersion,
        async execute(actor, args) {
          await authoring.updateProductFields(
            actor,
            args.domainId,
            args.changes,
          );
          return done(
            "تم تعديل تفاصيل المنتج.",
            productHref(args.domainId),
            `product:${args.domainId}`,
          );
        },
      } satisfies Handler<{
        domainId: string;
        changes: Record<string, unknown>;
      }>,
      productPublication: {
        args: z.object({
          domainId: z.string(),
          publication: z.enum(["draft", "published", "hidden"]),
          availability: z.enum(["available", "unavailable"]),
          acceptPlaceholder: z.boolean(),
        }),
        version: productVersion,
        async execute(actor, args) {
          await authoring.setPublication(actor, args);
          return done(
            "تم تغيير ظهور المنتج.",
            productHref(args.domainId),
            `product:${args.domainId}`,
          );
        },
      } satisfies Handler<{
        domainId: string;
        publication: "draft" | "published" | "hidden";
        availability: "available" | "unavailable";
        acceptPlaceholder: boolean;
      }>,
      productRestore: {
        args: z.object({ domainId: z.string() }),
        version: (_actor, args) => authoring.productVersion(args.domainId),
        async execute(actor, args) {
          await authoring.restoreProduct(actor, args.domainId);
          return done(
            "تم استرجاع المنتج مخفياً.",
            productHref(args.domainId),
            `product:${args.domainId}`,
          );
        },
      } satisfies Handler<{ domainId: string }>,
      productImageRemoval: {
        args: z.object({ domainId: z.string() }),
        version: productVersion,
        async execute(actor, args) {
          await authoring.removeProductImage(actor, args.domainId);
          return done(
            "أُزيلت صورة المنتج.",
            productHref(args.domainId),
            `product:${args.domainId}`,
          );
        },
      } satisfies Handler<{ domainId: string }>,
      productDelete: {
        args: z.object({ domainId: z.string(), reason: z.string().max(200) }),
        version: productVersion,
        async execute(actor, args) {
          await deleteProduct(actor, args.domainId);
          return done(
            "تم حذف المنتج نهائياً.",
            "/admin/products",
            `product:${args.domainId}`,
          );
        },
      } satisfies Handler<{ domainId: string; reason: string }>,
      variantCreate: {
        args: z.object({
          productDomainId: z.string(),
          variant: z.record(z.string(), z.unknown()),
        }),
        version: (_actor, args) =>
          authoring.productVersion(args.productDomainId),
        async execute(actor, args) {
          const result = await authoring.createVariant(
            actor,
            args.productDomainId,
            args.variant as Parameters<
              CatalogAuthoringService["createVariant"]
            >[2],
          );
          return done(
            "تمت إضافة الصنف.",
            productHref(args.productDomainId),
            `variant:${result.variantId}`,
          );
        },
      } satisfies Handler<{
        productDomainId: string;
        variant: Record<string, unknown>;
      }>,
      variantUpdate: {
        args: z.object({
          variantId: z.string(),
          changes: z.record(z.string(), z.unknown()),
        }),
        version: variantVersion,
        async execute(actor, args) {
          await authoring.updateVariant(actor, args.variantId, args.changes);
          return done("تم تعديل الصنف.", null, `variant:${args.variantId}`);
        },
      } satisfies Handler<{
        variantId: string;
        changes: Record<string, unknown>;
      }>,
      variantDefault: {
        args: z.object({ variantId: z.string() }),
        version: variantVersion,
        async execute(actor, args) {
          await authoring.setDefaultVariant(actor, args.variantId);
          return done(
            "تم تغيير الصنف الافتراضي.",
            null,
            `variant:${args.variantId}`,
          );
        },
      } satisfies Handler<{ variantId: string }>,
      variantImage: {
        args: z.object({
          variantId: z.string(),
          attachmentId: z.uuid(),
          alt: z.string().max(250),
        }),
        version: variantVersion,
        async execute(actor, args) {
          const stored = await storeAttachmentImage(
            services,
            actor,
            args.attachmentId,
          );
          await authoring.setVariantImage(actor, args.variantId, {
            ...stored,
            alt: args.alt,
          });
          return done(
            "تم تغيير صورة الصنف.",
            null,
            `variant:${args.variantId}`,
          );
        },
      } satisfies Handler<{
        variantId: string;
        attachmentId: string;
        alt: string;
      }>,
      variantArchive: {
        args: z.object({ variantId: z.string() }),
        version: variantVersion,
        async execute(actor, args) {
          await authoring.archiveVariant(actor, args.variantId);
          return done("تمت أرشفة الصنف.", null, `variant:${args.variantId}`);
        },
      } satisfies Handler<{ variantId: string }>,
      variantRestore: {
        args: z.object({ variantId: z.string() }),
        version: variantVersion,
        async execute(actor, args) {
          await authoring.restoreVariant(actor, args.variantId);
          return done("تم استرجاع الصنف.", null, `variant:${args.variantId}`);
        },
      } satisfies Handler<{ variantId: string }>,
      variantDelete: {
        args: z.object({ variantId: z.string() }),
        async version(_actor, args) {
          const [version, refs] = await Promise.all([
            authoring.variantVersion(args.variantId),
            authoring.variantReferences(args.variantId),
          ]);
          return version && refs
            ? sha256(`${version}|${canonicalJson(refs)}`)
            : null;
        },
        async execute(actor, args) {
          await authoring.deleteUnusedVariant(actor, args.variantId);
          return done(
            "تم حذف الصنف نهائياً.",
            null,
            `variant:${args.variantId}`,
          );
        },
      } satisfies Handler<{ variantId: string }>,
      specificationUpsert: {
        args: z.object({
          productDomainId: z.string(),
          specificationId: z.uuid().optional(),
          labelAr: z.string().max(80),
          valueAr: z.string().max(200),
          sortOrder: z.number().int().min(0),
        }),
        version: (_actor, args) =>
          authoring.productVersion(args.productDomainId),
        async execute(actor, args) {
          await catalog.upsertSpecification(actor, args);
          return done(
            "تم حفظ المواصفة.",
            productHref(args.productDomainId),
            `product:${args.productDomainId}`,
          );
        },
      } satisfies Handler<{
        productDomainId: string;
        specificationId?: string;
        labelAr: string;
        valueAr: string;
        sortOrder: number;
      }>,
      specificationRemove: {
        args: z.object({
          productDomainId: z.string(),
          specificationId: z.uuid(),
        }),
        version: (_actor, args) =>
          authoring.productVersion(args.productDomainId),
        async execute(actor, args) {
          await catalog.removeSpecification(actor, args);
          return done(
            "تم حذف المواصفة.",
            productHref(args.productDomainId),
            `product:${args.productDomainId}`,
          );
        },
      } satisfies Handler<{ productDomainId: string; specificationId: string }>,
      categoryCreate: {
        args: z.object({
          code: z.string(),
          nameAr: z.string(),
          description: z.string().nullable(),
          icon: z.enum(categoryIconKeys),
          visible: z.boolean(),
        }),
        async version(_actor, args) {
          return (await authoring.categoryVersion(args.code)) ? null : "new";
        },
        async execute(actor, args) {
          await authoring.createCategory(actor, args);
          return done(
            `تمت إضافة قسم ${args.nameAr}.`,
            categoriesHref,
            `category:${args.code}`,
          );
        },
      } satisfies Handler<{
        code: string;
        nameAr: string;
        description: string | null;
        icon: CategoryIconKey;
        visible: boolean;
      }>,
      categoryUpdate: {
        args: z.object({
          code: z.string(),
          changes: z.record(z.string(), z.unknown()),
        }),
        version: categoryVersion,
        async execute(actor, args) {
          await authoring.updateCategory(actor, args.code, args.changes);
          return done(
            "تم تعديل القسم.",
            categoriesHref,
            `category:${args.code}`,
          );
        },
      } satisfies Handler<{ code: string; changes: Record<string, unknown> }>,
      categoryArchive: {
        args: z.object({ code: z.string() }),
        version: categoryVersion,
        async execute(actor, args) {
          await authoring.archiveCategory(actor, args.code);
          return done(
            "تمت أرشفة القسم.",
            categoriesHref,
            `category:${args.code}`,
          );
        },
      } satisfies Handler<{ code: string }>,
      categoryRestore: {
        args: z.object({ code: z.string() }),
        version: categoryVersion,
        async execute(actor, args) {
          await authoring.restoreCategory(actor, args.code);
          return done(
            "تم استرجاع القسم مخفياً.",
            categoriesHref,
            `category:${args.code}`,
          );
        },
      } satisfies Handler<{ code: string }>,
      categoryMerge: {
        args: z.object({ sourceCode: z.string(), targetCode: z.string() }),
        async version(_actor, args) {
          const [source, target] = await Promise.all([
            authoring.categoryVersion(args.sourceCode),
            authoring.categoryVersion(args.targetCode),
          ]);
          return source && target ? sha256(`${source}|${target}`) : null;
        },
        async execute(actor, args) {
          const result = await authoring.mergeCategories(actor, args);
          return done(
            `تم الدمج ونقل ${result.moved} منتج.`,
            categoriesHref,
            `category:${args.targetCode}`,
          );
        },
      } satisfies Handler<{ sourceCode: string; targetCode: string }>,
      categoryMove: {
        args: z.object({
          productDomainIds: z.array(z.string()).min(1).max(50),
          targetCode: z.string(),
        }),
        async version(_actor, args) {
          const versions = await Promise.all([
            authoring.categoryVersion(args.targetCode),
            ...args.productDomainIds.map((id) => authoring.productVersion(id)),
          ]);
          return versions.every(Boolean)
            ? sha256(canonicalJson(versions))
            : null;
        },
        async execute(actor, args) {
          const result = await authoring.moveProducts(actor, args);
          return done(
            `تم نقل ${result.moved} منتج.`,
            categoriesHref,
            `category:${args.targetCode}`,
          );
        },
      } satisfies Handler<{ productDomainIds: string[]; targetCode: string }>,
      categoryDelete: {
        args: z.object({ code: z.string() }),
        version: categoryVersion,
        async execute(actor, args) {
          await authoring.deleteEmptyCategory(actor, args.code);
          return done(
            "تم حذف القسم نهائياً.",
            categoriesHref,
            `category:${args.code}`,
          );
        },
      } satisfies Handler<{ code: string }>,
    };
    return handlers as unknown as Record<CatalogOperation, Handler<never>>;
  }
}

export { authoringMessage, type DuplicateCandidate };
