import "server-only";

import { eq } from "drizzle-orm";
import sharp from "sharp";
import { z } from "zod";

import type {
  AdminCatalogService,
  AdminProductUpdate,
} from "@/features/admin/application/admin-catalog-service";
import type { AdminOrderService } from "@/features/admin/application/admin-order-service";
import type { ProductMaintenanceService } from "@/features/admin/application/product-maintenance-service";
import type { AdminActor } from "@/features/admin/domain/admin-actor";
import { can } from "@/features/admin/domain/permissions";
import type { CatalogAuthoringService } from "@/features/admin/application/catalog-authoring-service";
import { categoryCodeSchema } from "@/features/catalog/domain/category";
import type { Product } from "@/features/catalog/domain/product";
import type { InventoryService } from "@/features/inventory/application/inventory-service";
import type { Database } from "@/features/inventory/application/stock-ledger";
import {
  formatQuantity,
  parseQuantityToMilli,
} from "@/features/inventory/domain/quantity";
import { stockUnitLabels } from "@/features/inventory/domain/stock-constants";
import type { ExtractionService } from "@/features/purchasing/application/extraction-service";
import type { CustomerService } from "@/features/sales/application/customer-service";
import type {
  SaleInput,
  SalesService,
} from "@/features/sales/application/sales-service";
import { orderStatusLabels } from "@/features/orders/domain/order-status";
import { calculateSale } from "@/features/sales/domain/sale-calculation";
import { formatIls } from "@/shared/lib/format-currency";
import { parseIlsToAgorot } from "@/shared/lib/parse-ils";
import { matchSellingUnit } from "@/features/catalog/domain/selling-unit";
import { normalizeArabicText } from "@/shared/lib/normalize-arabic";
import { moneyRejection } from "@/features/assistant/domain/money-rejection";
import type { InvoiceExtractor } from "@/server/ai/invoice-extractor";
import * as schema from "@/server/db/schema";
import { ProductOptionsService } from "@/features/admin/application/product-options-service";
import type { ProductImageStore } from "@/server/storage/product-images";

import type { AssistantOperation } from "../domain/assistant-policy";
import { sha256, canonicalJson } from "../domain/confirmation-token";
import {
  forChanges,
  resolveCatalogEntity,
  scopedCandidates,
  selectionQuestion,
  type CatalogEntry,
  type EntityCandidate,
} from "../domain/entity-match";
import type { AttachmentService } from "./attachment-service";
import { CatalogOperations } from "./catalog-operations";
import { PartyOperations } from "./party-operations";
import { MediaOperations } from "./media-operations";
import { SellingUnitOperations } from "./selling-unit-operations";
import type { SellingUnitService } from "@/features/admin/application/selling-unit-service";
import type { OfferService } from "@/features/offers/application/offer-service";
import type { SupplierMaintenanceService } from "@/features/purchasing/application/supplier-maintenance-service";
import type { SupplierService } from "@/features/purchasing/application/supplier-service";
import type { CustomerMaintenanceService } from "@/features/sales/application/customer-maintenance-service";

export interface ConfirmationCard {
  title: string;
  target: { label: string; href: string | null };
  rows: Array<{ label: string; before: string | null; after: string }>;
  impact: string[];
  warnings: string[];
  images?: { before: string | null; after: string };
  confirmLabel: string;
  destructive: boolean;
  reversible?: boolean;
  dependencies?: string[];
}

export type PrepareResult =
  | {
      status: "ready";
      operation: AssistantOperation;
      args: Record<string, unknown>;
      card: ConfirmationCard;
      summary: string;
    }
  | {
      status: "needs_selection";
      field: string;
      question: string;
      options: Array<{ id: string; label: string }>;
    }
  | { status: "rejected"; code: string; message: string; values?: string[] };

export interface ExecutionResult {
  message: string;
  href: string | null;
  ref: string;
}

export interface Handler<A> {
  args: z.ZodType<A>;
  version(actor: AdminActor, args: A): Promise<string | null>;
  execute(
    actor: AdminActor,
    args: A,
    key: string,
    version: string,
  ): Promise<ExecutionResult>;
}

export interface OperationHandler {
  parse(args: unknown): unknown;
  version(actor: AdminActor, args: unknown): Promise<string | null>;
  execute(
    actor: AdminActor,
    args: unknown,
    key: string,
    version: string,
  ): Promise<ExecutionResult>;
}

// Stored arguments are re-validated before every use; nothing reaches a service unparsed.
function erase<A>(handler: Handler<A>): OperationHandler {
  const parse = (args: unknown) => {
    const parsed = handler.args.safeParse(args);
    if (!parsed.success) throw new Error("invalid_stored_args");
    return parsed.data;
  };
  return {
    parse,
    version: (actor, args) => handler.version(actor, parse(args)),
    execute: (actor, args, key, version) =>
      handler.execute(actor, parse(args), key, version),
  };
}

export interface OperationServices {
  database: Database;
  catalog: AdminCatalogService;
  authoring: CatalogAuthoringService;
  maintenance: ProductMaintenanceService;
  sellingUnits: SellingUnitService;
  inventory: InventoryService;
  sales: SalesService;
  customers: CustomerService;
  customerMaintenance: CustomerMaintenanceService;
  suppliers: SupplierService;
  supplierMaintenance: SupplierMaintenanceService;
  offers: OfferService;
  orders: AdminOrderService;
  extraction: ExtractionService;
  attachments: AttachmentService;
  productImages: () => ProductImageStore;
  invoiceExtractor: () => InvoiceExtractor;
}

const productHref = (domainId: string) => `/admin/products/${domainId}`;
const stockHref = (variantId: string) => `/admin/inventory/stock/${variantId}`;
const rejected = (code: string, message: string): PrepareResult => ({
  status: "rejected",
  code,
  message,
});

function selection(
  field: string,
  question: string,
  candidates: EntityCandidate[],
  scope: "product" | "variant",
): PrepareResult {
  return {
    status: "needs_selection",
    field,
    question,
    options: scopedCandidates(candidates, scope).map((item) => ({
      id: scope === "product" ? item.productId : item.variantId,
      label: item.label,
    })),
  };
}

export function catalogEntries(products: readonly Product[]): CatalogEntry[] {
  return products.flatMap((product) =>
    product.variants.map((variant) => ({
      productId: product.id,
      variantId: variant.id,
      nameAr: product.nameAr,
      latinName: product.latinName ?? null,
      variantLabel: product.variants.length > 1 ? variant.labelAr : null,
      sku: variant.sku ?? null,
      barcode: variant.barcode ?? null,
    })),
  );
}

async function productVersion(database: Database, domainId: string) {
  const [row] = await database
    .select({
      updatedAt: schema.products.updatedAt,
      archivedAt: schema.products.archivedAt,
    })
    .from(schema.products)
    .where(eq(schema.products.domainId, domainId))
    .limit(1);
  if (!row || row.archivedAt) return null;
  return row.updatedAt.toISOString();
}

const quantityText = (milli: number) => formatQuantity(milli);

export class AssistantOperations {
  readonly handlers: Record<AssistantOperation, OperationHandler>;
  readonly catalogOps: CatalogOperations;
  readonly partyOps: PartyOperations;
  readonly mediaOps: MediaOperations;
  readonly sellingUnitOps: SellingUnitOperations;
  readonly productOptions: ProductOptionsService;

  constructor(private readonly services: OperationServices) {
    this.productOptions = new ProductOptionsService(
      services.database,
      services.authoring,
    );
    this.catalogOps = new CatalogOperations({
      catalog: services.catalog,
      authoring: services.authoring,
      attachments: services.attachments,
      productImages: services.productImages,
      hasOptions: async (domainId) =>
        Boolean((await this.productOptions.matrix(domainId))?.options.length),
      resolveProduct: (actor, query, scope, field) =>
        this.resolveProduct(actor, query, scope, field),
      resolveVariant: (actor, query, field) =>
        this.resolveVariant(actor, query, field),
    });
    this.partyOps = new PartyOperations({
      customers: services.customers,
      customerMaintenance: services.customerMaintenance,
      sales: services.sales,
      suppliers: services.suppliers,
      supplierMaintenance: services.supplierMaintenance,
      offers: services.offers,
      catalogOps: this.catalogOps,
      resolveProduct: (actor, query, scope, field) =>
        this.resolveProduct(actor, query, scope, field),
    });
    this.mediaOps = new MediaOperations({
      options: this.productOptions,
      attachments: services.attachments,
      productImages: services.productImages,
      resolveProduct: (actor, query, scope, field, purpose) =>
        this.resolveProduct(actor, query, scope, field, purpose),
    });
    this.sellingUnitOps = new SellingUnitOperations({
      sellingUnits: services.sellingUnits,
      resolveProduct: (actor, query, scope, field) =>
        this.resolveProduct(actor, query, scope, field),
    });
    const built = {
      ...this.buildHandlers(),
      ...this.partyOps.buildHandlers(),
      ...this.mediaOps.buildHandlers(),
      ...this.sellingUnitOps.buildHandlers(),
      ...this.catalogOps.buildHandlers(async (actor, domainId) => {
        await services.maintenance.deleteUnreferenced(actor, domainId);
      }),
    };
    this.handlers = Object.fromEntries(
      Object.entries(built).map(([name, handler]) => [
        name,
        erase(handler as Handler<unknown>),
      ]),
    ) as Record<AssistantOperation, OperationHandler>;
  }

  productReferences(actor: AdminActor, domainId: string) {
    return this.services.maintenance.references(actor, domainId);
  }

  async resolveProduct(
    actor: AdminActor,
    query: string,
    scope: "product" | "variant",
    field: string,
    purpose: "change" | "read" = "change",
  ): Promise<
    | { ok: true; match: EntityCandidate; product: Product }
    | { ok: false; result: PrepareResult }
  > {
    const products = await this.services.catalog.list(actor);
    let resolution = resolveCatalogEntity(
      query,
      catalogEntries(products),
      scope,
    );
    // A single product whose Arabic name is exactly what was said wins over near matches.
    if (resolution.status === "ambiguous") {
      const wanted = query.trim();
      const exact = resolution.candidates.filter(
        (candidate) =>
          products
            .find((item) => item.id === candidate.productId)
            ?.nameAr.trim() === wanted,
      );
      const exactProducts = new Set(
        exact.map((candidate) => candidate.productId),
      );
      if (
        exactProducts.size === 1 &&
        (scope === "product" || exact.length === 1)
      ) {
        resolution = { status: "resolved", match: exact[0]! };
      }
    }
    // Only a change waits for the owner to confirm a near match; a read answers about the one match it found.
    if (purpose === "change") resolution = forChanges(resolution);
    if (resolution.status === "not_found") {
      return {
        ok: false,
        result: rejected(
          "not_found",
          `ما لقيت منتج باسم «${query.slice(0, 60)}». جربي اسماً آخر أو الباركود.`,
        ),
      };
    }
    if (resolution.status === "ambiguous") {
      return {
        ok: false,
        result: selection(
          field,
          selectionQuestion(resolution.candidates, query, scope),
          resolution.candidates,
          scope,
        ),
      };
    }
    const product = products.find(
      (item) => item.id === resolution.match.productId,
    );
    if (!product) {
      return { ok: false, result: rejected("not_found", "المنتج غير موجود.") };
    }
    return { ok: true, match: resolution.match, product };
  }

  async resolveVariant(actor: AdminActor, query: string, field: string) {
    const resolved = await this.resolveProduct(actor, query, "variant", field);
    if (!resolved.ok) return resolved;
    const { product, match } = resolved;
    if (
      product.variants.length > 1 &&
      match.method !== "id" &&
      match.method !== "barcode" &&
      match.method !== "sku" &&
      !match.label.includes("—")
    ) {
      return {
        ok: false as const,
        result: selection(
          field,
          `«${product.nameAr}» له أكثر من صنف، أي واحد؟`,
          catalogEntries([product]).map((entry) => ({
            productId: entry.productId,
            variantId: entry.variantId,
            label: `${entry.nameAr} — ${entry.variantLabel ?? ""}`,
            confidence: 0,
            method: "exact_name" as const,
          })),
          "variant",
        ),
      };
    }
    return resolved;
  }

  async prepareProductUpdate(
    actor: AdminActor,
    input: {
      product: string;
      changes: {
        nameAr?: string;
        latinName?: string | null;
        description?: string;
        categoryId?: string;
        unit?: string;
        priceIls?: string;
        availability?: "available" | "unavailable";
      };
    },
  ): Promise<PrepareResult> {
    const resolved = await this.resolveProduct(
      actor,
      input.product,
      "product",
      "product",
    );
    if (!resolved.ok) return resolved.result;
    const { product } = resolved;
    const changes: Record<string, unknown> = {};
    const rows: ConfirmationCard["rows"] = [];
    const { changes: requested } = input;

    if (requested.nameAr !== undefined) {
      const name = requested.nameAr.trim();
      if (name.length < 2 || name.length > 160) {
        return rejected("invalid_input", "الاسم الجديد قصير أو طويل جداً.");
      }
      if (name !== product.nameAr) {
        changes.nameAr = name;
        rows.push({ label: "الاسم", before: product.nameAr, after: name });
      }
    }
    if (requested.latinName !== undefined) {
      const latin = requested.latinName?.trim() || null;
      if (latin && latin.length > 120) {
        return rejected("invalid_input", "الاسم اللاتيني طويل جداً.");
      }
      if (latin !== (product.latinName ?? null)) {
        changes.latinName = latin;
        rows.push({
          label: "الاسم اللاتيني/الماركة",
          before: product.latinName ?? "—",
          after: latin ?? "—",
        });
      }
    }
    if (requested.description !== undefined) {
      const description = requested.description.trim();
      if (description.length > 4_000) {
        return rejected("invalid_input", "الوصف طويل جداً.");
      }
      if (description !== (product.description ?? "")) {
        changes.description = description;
        rows.push({
          label: "الوصف",
          before: product.description
            ? `${product.description.slice(0, 80)}…`
            : "—",
          after: description ? `${description.slice(0, 80)}…` : "—",
        });
      }
    }
    if (requested.categoryId !== undefined) {
      const category = await this.catalogOps.resolveCategory(
        requested.categoryId,
      );
      if (!category.ok) return category.result;
      if (category.category.code !== product.categoryId) {
        changes.categoryId = category.category.code;
        rows.push({
          label: "القسم",
          before:
            category.categories.find((row) => row.code === product.categoryId)
              ?.nameAr ?? product.categoryId,
          after: category.category.nameAr,
        });
      }
    }
    if (requested.unit !== undefined) {
      const unit = requested.unit.trim();
      if (unit.length > 80) return rejected("invalid_input", "الوحدة طويلة.");
      if (unit !== (product.unit ?? "")) {
        changes.unit = unit;
        rows.push({
          label: "الوحدة",
          before: product.unit ?? "—",
          after: unit || "—",
        });
      }
    }
    if (requested.priceIls !== undefined) {
      const price = parseIlsToAgorot(requested.priceIls);
      if (!price) {
        return moneyRejection(requested.priceIls);
      }
      if (price !== product.priceAgorot) {
        changes.priceAgorot = price;
        rows.push({
          label: "سعر البيع",
          before: formatIls(product.priceAgorot),
          after: formatIls(price),
        });
      }
    }
    if (requested.availability !== undefined) {
      if (requested.availability !== product.availability) {
        changes.availability = requested.availability;
        const label = (value: string) =>
          value === "available" ? "متوفر للبيع" : "غير متوفر";
        rows.push({
          label: "الحالة في المتجر",
          before: label(product.availability),
          after: label(requested.availability),
        });
      }
    }
    if (!rows.length) {
      return rejected(
        "no_change",
        "القيم المطلوبة هي نفسها الحالية، لا يوجد ما يتغيّر.",
      );
    }
    const warnings: string[] = [];
    if (changes.priceAgorot !== undefined) {
      warnings.push("سعر البيع في المتجر سيتغيّر فوراً بعد التأكيد.");
    }
    return {
      status: "ready",
      operation: "productUpdate",
      args: { domainId: product.id, changes },
      summary: `تعديل ${product.nameAr}`,
      card: {
        title: "تعديل منتج",
        target: { label: product.nameAr, href: productHref(product.id) },
        rows,
        impact: [],
        warnings,
        confirmLabel: "تأكيد التعديل",
        destructive: false,
      },
    };
  }

  async prepareProductImageReplacement(
    actor: AdminActor,
    input: { product: string; attachmentId: string },
  ): Promise<PrepareResult> {
    const resolved = await this.resolveProduct(
      actor,
      input.product,
      "product",
      "product",
    );
    if (!resolved.ok) return resolved.result;
    const attachment = await this.services.attachments.get(
      actor,
      input.attachmentId,
    );
    if (!attachment || attachment.mimeType !== "image/jpeg") {
      return rejected(
        "attachment_missing",
        "أرفقي صورة المنتج الجديدة أولاً من زر المرفقات.",
      );
    }
    const { product } = resolved;
    return {
      status: "ready",
      operation: "productImageReplacement",
      args: { domainId: product.id, attachmentId: attachment.id },
      summary: `تغيير صورة ${product.nameAr}`,
      card: {
        title: "استبدال صورة المنتج",
        target: { label: product.nameAr, href: productHref(product.id) },
        rows: [],
        impact: ["الصورة الجديدة ستظهر في المتجر وفي لوحة الإدارة."],
        warnings: [],
        images: {
          before: product.image.kind === "image" ? product.image.src : null,
          after: `/admin/api/assistant/attachments/${attachment.id}`,
        },
        confirmLabel: "تأكيد استبدال الصورة",
        destructive: false,
      },
    };
  }

  async prepareProductArchive(
    actor: AdminActor,
    input: { product: string; reason: string },
  ): Promise<PrepareResult> {
    if (!can(actor, "settings.manage")) {
      return rejected("forbidden", "حذف أو أرشفة المنتجات للمالك فقط.");
    }
    const resolved = await this.resolveProduct(
      actor,
      input.product,
      "product",
      "product",
    );
    if (!resolved.ok) return resolved.result;
    const { product } = resolved;
    const references = await this.services.maintenance.references(
      actor,
      product.id,
    );
    if (!references) return rejected("not_found", "المنتج غير موجود.");
    const reason = input.reason.trim().slice(0, 200) || "منتج غير صحيح";
    return {
      status: "ready",
      operation: "productArchive",
      args: { domainId: product.id, mode: "archive", reason },
      summary: `أرشفة ${product.nameAr}`,
      card: {
        title: "أرشفة منتج",
        target: { label: product.nameAr, href: productHref(product.id) },
        rows: [
          {
            label: "السجلات المرتبطة",
            before: null,
            after: `طلبات ${references.orders} · مشتريات ${references.purchases} · مبيعات ${references.sales} · حركات مخزون ${references.stockMovements}`,
          },
        ],
        impact: [
          "يختفي المنتج من المتجر والقوائم، ويبقى تاريخه وسجلاته كما هي. يمكن استرجاعه لاحقاً.",
        ],
        warnings: [],
        confirmLabel: "تأكيد الأرشفة",
        destructive: false,
        reversible: true,
      },
    };
  }

  async prepareProductMerge(
    actor: AdminActor,
    input: { duplicate: string; target: string },
  ): Promise<PrepareResult> {
    if (!can(actor, "settings.manage") || !can(actor, "stock.adjust")) {
      return rejected("forbidden", "دمج المنتجات للمالك فقط.");
    }
    const source = await this.resolveProduct(
      actor,
      input.duplicate,
      "product",
      "duplicate",
    );
    if (!source.ok) return source.result;
    const target = await this.resolveProduct(
      actor,
      input.target,
      "product",
      "target",
    );
    if (!target.ok) return target.result;
    if (source.product.id === target.product.id) {
      return rejected(
        "same_product",
        "المنتج المكرر والمنتج الأصلي نفس المنتج.",
      );
    }
    const stock = await this.services.maintenance.onHandByVariant(
      source.product.id,
    );
    if (stock.some((row) => row.reservedMilli > 0)) {
      return rejected(
        "reserved_stock",
        "على المنتج المكرر كميات محجوزة لطلبات مفتوحة. أنهي الطلبات أو ألغيها أولاً.",
      );
    }
    const moved = stock.reduce((total, row) => total + row.onHandMilli, 0);
    return {
      status: "ready",
      operation: "productMerge",
      args: {
        sourceDomainId: source.product.id,
        targetDomainId: target.product.id,
      },
      summary: `دمج ${source.product.nameAr} في ${target.product.nameAr}`,
      card: {
        title: "دمج منتج مكرر",
        target: {
          label: target.product.nameAr,
          href: productHref(target.product.id),
        },
        rows: [
          {
            label: "المنتج المكرر",
            before: null,
            after: source.product.nameAr,
          },
          { label: "يُدمج في", before: null, after: target.product.nameAr },
          {
            label: "الكمية المنقولة",
            before: null,
            after: quantityText(moved),
          },
        ],
        impact: [
          "تُنقل الكمية الموجودة بتكلفتها المسجّلة، فلا تتغيّر قيمة المخزون.",
          "يُؤرشف المنتج المكرر ويبقى تاريخ طلباته وفواتيره كما هو.",
          "أسماء الموردين المحفوظة تنتقل للمنتج الأصلي.",
        ],
        warnings: [],
        confirmLabel: "تأكيد الدمج",
        destructive: true,
      },
    };
  }

  async prepareInventoryCorrection(
    actor: AdminActor,
    input: {
      product: string;
      reason: "correction" | "damaged" | "expired";
      quantity: string;
      note?: string;
    },
  ): Promise<PrepareResult> {
    if (!can(actor, "stock.adjust")) {
      return rejected("forbidden", "تعديل المخزون للمالك فقط.");
    }
    const quantityMilli = parseQuantityToMilli(input.quantity);
    if (quantityMilli === null) {
      return rejected("invalid_input", "الكمية غير مفهومة. اكتبيها بالأرقام.");
    }
    const resolved = await this.resolveVariant(actor, input.product, "product");
    if (!resolved.ok) return resolved.result;
    const detail = await this.services.inventory.getVariantStock(
      actor,
      resolved.match.variantId,
    );
    if (!detail) return rejected("not_found", "الصنف غير موجود.");
    const { stock } = detail;
    if (!stock.tracked && input.reason !== "correction") {
      return rejected("untracked", "هذا الصنف غير متتبَّع بالمخزون بعد.");
    }
    const after =
      input.reason === "correction"
        ? quantityMilli
        : stock.onHandMilli - quantityMilli;
    if (after === stock.onHandMilli) {
      return rejected(
        "no_change",
        `الكمية الحالية ${quantityText(stock.onHandMilli)} أصلاً.`,
      );
    }
    if (after < stock.reservedMilli) {
      return rejected(
        "insufficient_stock",
        `لا يمكن أن تقل الكمية عن المحجوز لطلبات (${quantityText(stock.reservedMilli)}).`,
      );
    }
    if (
      after > stock.onHandMilli &&
      stock.avgCostAgorot === null &&
      !stock.tracked
    ) {
      return rejected(
        "cost_required",
        "زيادة كمية صنف بدون تكلفة سابقة تحتاج تسجيل شراء أو رصيد افتتاحي من شاشة المخزون.",
      );
    }
    const unit = stockUnitLabels[stock.unit];
    const reasonLabel = {
      correction: "تصحيح جرد",
      damaged: "تالف",
      expired: "منتهي الصلاحية",
    }[input.reason];
    const valueImpact =
      stock.avgCostAgorot !== null
        ? `أثر تقديري على قيمة المخزون: ${formatIls(
            Math.round(
              ((after - stock.onHandMilli) * stock.avgCostAgorot) / 1_000,
            ),
          )}`
        : "قيمة المخزون تُحسب من التكلفة المسجّلة.";
    return {
      status: "ready",
      operation: "inventoryCorrection",
      args: {
        variantId: stock.variantId,
        reason: input.reason,
        quantityMilli,
        note: input.note?.trim().slice(0, 200) || undefined,
      },
      summary: `${reasonLabel}: ${stock.name}`,
      card: {
        title: "تعديل كمية المخزون",
        target: { label: stock.name, href: stockHref(stock.variantId) },
        rows: [
          { label: "السبب", before: null, after: reasonLabel },
          {
            label: "الكمية",
            before: `${quantityText(stock.onHandMilli)} ${unit}`,
            after: `${quantityText(after)} ${unit}`,
          },
        ],
        impact: [
          valueImpact,
          "يُسجّل التعديل كحركة جديدة ولا تُحذف أي حركة سابقة.",
        ],
        warnings: [],
        confirmLabel: "تأكيد تعديل المخزون",
        destructive: true,
      },
    };
  }

  async prepareStockTransfer(
    actor: AdminActor,
    input: { from: string; to: string; quantity: string },
  ): Promise<PrepareResult> {
    if (!can(actor, "stock.adjust")) {
      return rejected("forbidden", "نقل المخزون للمالك فقط.");
    }
    const quantityMilli = parseQuantityToMilli(input.quantity);
    if (!quantityMilli) return rejected("invalid_input", "الكمية غير مفهومة.");
    const from = await this.resolveVariant(actor, input.from, "from");
    if (!from.ok) return from.result;
    const to = await this.resolveVariant(actor, input.to, "to");
    if (!to.ok) return to.result;
    if (from.match.variantId === to.match.variantId) {
      return rejected("same_product", "المصدر والوجهة نفس الصنف.");
    }
    const [source, destination] = await Promise.all([
      this.services.inventory.getVariantStock(actor, from.match.variantId),
      this.services.inventory.getVariantStock(actor, to.match.variantId),
    ]);
    if (!source || !destination)
      return rejected("not_found", "الصنف غير موجود.");
    if (!source.stock.tracked || source.stock.availableMilli < quantityMilli) {
      return rejected(
        "insufficient_stock",
        `المتوفر من ${source.stock.name} ${quantityText(Math.max(source.stock.availableMilli, 0))} فقط.`,
      );
    }
    return {
      status: "ready",
      operation: "stockTransfer",
      args: {
        fromVariantId: source.stock.variantId,
        toVariantId: destination.stock.variantId,
        quantityMilli,
      },
      summary: `نقل ${quantityText(quantityMilli)} من ${source.stock.name} إلى ${destination.stock.name}`,
      card: {
        title: "نقل كمية بين منتجين",
        target: {
          label: destination.stock.name,
          href: stockHref(destination.stock.variantId),
        },
        rows: [
          {
            label: source.stock.name,
            before: quantityText(source.stock.onHandMilli),
            after: quantityText(source.stock.onHandMilli - quantityMilli),
          },
          {
            label: destination.stock.name,
            before: quantityText(destination.stock.onHandMilli),
            after: quantityText(destination.stock.onHandMilli + quantityMilli),
          },
        ],
        impact: [
          "تنتقل الكمية بتكلفتها المسجّلة، فلا تتغيّر قيمة المخزون الإجمالية.",
        ],
        warnings: [],
        confirmLabel: "تأكيد النقل",
        destructive: true,
      },
    };
  }

  async prepareReorderThreshold(
    actor: AdminActor,
    input: { product: string; threshold: string | null },
  ): Promise<PrepareResult> {
    if (!can(actor, "stock.adjust")) {
      return rejected("forbidden", "حد إعادة الطلب للمالك فقط.");
    }
    const thresholdMilli =
      input.threshold === null ? null : parseQuantityToMilli(input.threshold);
    if (input.threshold !== null && thresholdMilli === null) {
      return rejected("invalid_input", "الحد غير مفهوم.");
    }
    const resolved = await this.resolveVariant(actor, input.product, "product");
    if (!resolved.ok) return resolved.result;
    const detail = await this.services.inventory.getVariantStock(
      actor,
      resolved.match.variantId,
    );
    if (!detail?.stock.tracked) {
      return rejected("untracked", "الصنف غير متتبَّع بالمخزون بعد.");
    }
    const { stock } = detail;
    return {
      status: "ready",
      operation: "reorderThreshold",
      args: { variantId: stock.variantId, thresholdMilli },
      summary: `حد إعادة الطلب لـ ${stock.name}`,
      card: {
        title: "حد إعادة الطلب",
        target: { label: stock.name, href: stockHref(stock.variantId) },
        rows: [
          {
            label: "التنبيه عند",
            before:
              stock.reorderThresholdMilli === null
                ? "بدون حد"
                : quantityText(stock.reorderThresholdMilli),
            after:
              thresholdMilli === null
                ? "بدون حد"
                : quantityText(thresholdMilli),
          },
        ],
        impact: [],
        warnings: [],
        confirmLabel: "تأكيد الحد",
        destructive: false,
      },
    };
  }

  async prepareManualSale(
    actor: AdminActor,
    input: {
      customer: string | null;
      items: Array<{
        product: string;
        quantity: string;
        unitPriceIls?: string;
        sellingOption?: string;
      }>;
      payment: "full" | "partial" | "none";
      paidIls?: string;
    },
  ): Promise<PrepareResult> {
    if (!can(actor, "sales.record"))
      return rejected("forbidden", "لا تملكين صلاحية البيع.");
    if (!input.items.length || input.items.length > 20) {
      return rejected("invalid_input", "حددي المنتجات المباعة.");
    }
    const products = await this.services.catalog.list(actor);
    const entries = catalogEntries(products);
    const merged = new Map<string, SaleInput["lines"][number]>();
    for (const [index, item] of input.items.entries()) {
      let resolution = forChanges(
        resolveCatalogEntity(item.product, entries, "variant"),
      );
      let sellingOption = item.sellingOption;
      // «عرض الثلاث حبات منشفة مطبخ»: the full product (and variant) name is there and the rest names
      // exactly one unit of exactly one candidate; anything less stays a question.
      if (!sellingOption && resolution.status === "ambiguous") {
        const said = ` ${normalizeArabicText(item.product)} `;
        const fits = resolution.candidates.flatMap((match) => {
          const product = products.find((row) => row.id === match.productId);
          const variant = product?.variants.find(
            (row) => row.id === match.variantId,
          );
          if (!product || !variant) return [];
          let rest = said;
          for (const part of product.variants.length > 1
            ? [product.nameAr, variant.labelAr]
            : [product.nameAr]) {
            const words = ` ${normalizeArabicText(part)} `;
            if (!words.trim() || !rest.includes(words)) return [];
            rest = rest.replace(words, " ");
          }
          rest = rest.trim();
          return rest && matchSellingUnit(variant.sellingUnits, rest)
            ? [{ match, rest }]
            : [];
        });
        if (fits.length === 1) {
          resolution = { status: "resolved", match: fits[0]!.match };
          sellingOption = fits[0]!.rest;
        }
      }
      if (resolution.status === "not_found") {
        return rejected(
          "not_found",
          `ما لقيت منتج «${item.product.slice(0, 60)}».`,
        );
      }
      if (resolution.status === "ambiguous") {
        return selection(
          `items.${index}`,
          selectionQuestion(resolution.candidates, item.product, "variant"),
          resolution.candidates,
          "variant",
        );
      }
      const quantityMilli = parseQuantityToMilli(item.quantity);
      if (!quantityMilli) {
        return rejected(
          "invalid_input",
          `كمية «${item.product.slice(0, 40)}» غير مفهومة.`,
        );
      }
      const product = products.find(
        (row) => row.id === resolution.match.productId,
      );
      const variant = product?.variants.find(
        (row) => row.id === resolution.match.variantId,
      );
      if (!variant) return rejected("not_found", "المنتج غير موجود.");
      // A named way of selling (حبة، باكيج، كرتونة) makes the quantity a count of that unit.
      let unit: (typeof variant.sellingUnits)[number] | null = null;
      if (sellingOption) {
        const picked = matchSellingUnit(variant.sellingUnits, sellingOption);
        if (!picked) {
          return variant.sellingUnits.length
            ? {
                status: "needs_selection",
                field: `items.${index}.sellingOption`,
                question: `أي طريقة بيع لـ ${item.product.slice(0, 40)}؟`,
                options: variant.sellingUnits.map((entry) => ({
                  id: entry.labelAr,
                  label: `${entry.labelAr} — ${formatIls(entry.priceAgorot)} — يخصم ${entry.unitsPerSale}`,
                })),
              }
            : rejected(
                "not_found",
                `لا توجد طرق بيع فعّالة لـ ${item.product.slice(0, 40)}.`,
              );
        }
        if (quantityMilli % 1000 !== 0) {
          return rejected(
            "invalid_input",
            `عدد «${picked.labelAr}» يجب أن يكون رقماً صحيحاً.`,
          );
        }
        unit = picked;
      }
      const price =
        item.unitPriceIls === undefined
          ? (unit?.priceAgorot ?? variant.priceAgorot)
          : parseIlsToAgorot(item.unitPriceIls);
      if (price === null)
        return rejected("invalid_input", "سعر الوحدة غير مفهوم.");
      const key = `${variant.id}::${unit?.id ?? "base"}`;
      const existing = merged.get(key);
      merged.set(key, {
        variantId: variant.id,
        ...(unit ? { sellingUnitId: unit.id } : {}),
        quantityMilli: (existing?.quantityMilli ?? 0) + quantityMilli,
        unitPriceAgorot: price,
      });
    }

    let customerId: string | undefined;
    let customerName: string | undefined;
    if (input.customer) {
      const matches = await this.services.customers.findByName(
        actor,
        input.customer,
      );
      const exact = matches.filter((row) => row.exact);
      if (exact.length === 1) customerId = exact[0]!.id;
      else if (matches.length) {
        return {
          status: "needs_selection",
          field: "customer",
          question: `أي زبون تقصدين بـ «${input.customer.slice(0, 60)}»؟`,
          options: [
            ...matches
              .slice(0, 5)
              .map((row) => ({ id: row.id, label: row.name })),
            {
              id: `new:${input.customer.trim().slice(0, 100)}`,
              label: `زبون جديد باسم ${input.customer.trim().slice(0, 60)}`,
            },
          ],
        };
      } else if (z.uuid().safeParse(input.customer).success)
        customerId = input.customer;
      else if (input.customer.startsWith("new:"))
        customerName = input.customer.slice(4).trim();
      else customerName = input.customer.trim();
    }
    if (input.payment !== "full" && !customerId && !customerName) {
      return rejected(
        "customer_required",
        "البيع على الحساب يحتاج اسم الزبون.",
      );
    }

    const lines = [...merged.values()];
    const draft: Omit<SaleInput, "idempotencyKey"> = {
      ...(customerId ? { customerId } : {}),
      ...(customerName ? { customerName } : {}),
      source: "assistant",
      lines,
      discountAgorot: 0,
      paidAgorot: 0,
    };
    // The total comes from the lines alone. Previewing with nothing paid would apply the payment
    // rule too early and reject every anonymous cash sale; the real payment is checked below.
    const total = calculateSale({
      lines,
      discountAgorot: 0,
      paidAgorot: 0,
      hasCustomer: true,
    }).totalAgorot;
    let paidAgorot = 0;
    if (input.payment === "full") paidAgorot = total;
    if (input.payment === "partial") {
      const paid = input.paidIls ? parseIlsToAgorot(input.paidIls) : null;
      if (paid === null || paid <= 0 || paid > total) {
        return rejected(
          "invalid_input",
          "المبلغ المدفوع غير مفهوم أو أكبر من الإجمالي.",
        );
      }
      paidAgorot = paid;
    }
    const args = { ...draft, paidAgorot };
    const preview = await this.services.sales.preview(actor, {
      ...args,
      idempotencyKey: crypto.randomUUID(),
    });
    if (preview.blocked) {
      const short = preview.lines.find((line) => line.insufficient);
      return rejected(
        "insufficient_stock",
        short
          ? `الكمية المتوفرة من ${short.name} لا تكفي (${quantityText(short.availableBeforeMilli ?? 0)}).`
          : "لا يمكن تسجيل هذا البيع.",
      );
    }
    const rows: ConfirmationCard["rows"] = preview.lines.map((line) => ({
      label: line.sellingUnitLabel
        ? `${line.name} — ${line.sellingUnitLabel}`
        : line.name,
      before:
        line.tracked && line.availableBeforeMilli !== null
          ? `المخزون ${quantityText(line.availableBeforeMilli)}`
          : null,
      after: line.sellingUnitLabel
        ? `${line.sellingUnitLabel} × ${quantityText(line.saleQuantityMilli)} × ${formatIls(line.unitPriceAgorot)} = ${formatIls(line.lineTotalAgorot)} · يخصم ${quantityText(line.quantityMilli)} من المخزون`
        : `${quantityText(line.quantityMilli)} × ${formatIls(line.unitPriceAgorot)} = ${formatIls(line.lineTotalAgorot)}`,
    }));
    rows.push({
      label: "الإجمالي",
      before: null,
      after: formatIls(preview.totals.totalAgorot),
    });
    rows.push({
      label: "المدفوع الآن",
      before: null,
      after: formatIls(paidAgorot),
    });
    if (preview.balance) {
      rows.push({
        label: "رصيد الزبون",
        before: formatIls(preview.balance.beforeAgorot),
        after: formatIls(preview.balance.afterAgorot),
      });
    }
    const warnings = preview.lines
      .filter((line) => !line.tracked)
      .map(
        (line) =>
          `${line.name} غير متتبَّع بالمخزون؛ لن تُخصم كمية ولن يُحسب ربحه.`,
      );
    return {
      status: "ready",
      operation: "manualSale",
      args,
      summary: `بيع بقيمة ${formatIls(preview.totals.totalAgorot)}`,
      card: {
        title: "تسجيل بيع",
        target: {
          label: preview.customerName
            ? `${preview.customerName}${preview.newCustomer ? " (زبون جديد)" : ""}`
            : "بيع نقدي بدون اسم",
          href: null,
        },
        rows,
        impact: preview.profit
          ? [`ربح تقديري: ${formatIls(preview.profit.grossProfitAgorot)}`]
          : [],
        warnings,
        confirmLabel: "تأكيد وحفظ البيع",
        destructive: true,
      },
    };
  }

  async prepareCustomerPayment(
    actor: AdminActor,
    input: { customer: string; amountIls: string },
  ): Promise<PrepareResult> {
    if (!can(actor, "payments.record"))
      return rejected("forbidden", "لا تملكين صلاحية تسجيل الدفعات.");
    const amount = parseIlsToAgorot(input.amountIls);
    if (!amount) return moneyRejection(input.amountIls);
    let customer: { id: string; name: string } | undefined;
    if (z.uuid().safeParse(input.customer).success) {
      const detail = await this.services.customers.getDetail(
        actor,
        input.customer,
      );
      if (detail) customer = { id: detail.id, name: detail.name };
    } else {
      const matches = await this.services.customers.findByName(
        actor,
        input.customer,
      );
      const exact = matches.filter((row) => row.exact);
      if (exact.length === 1) customer = exact[0];
      else if (matches.length) {
        return {
          status: "needs_selection",
          field: "customer",
          question: "أي زبون تقصدين؟",
          options: matches
            .slice(0, 5)
            .map((row) => ({ id: row.id, label: row.name })),
        };
      }
    }
    if (!customer)
      return rejected(
        "not_found",
        `ما لقيت زبون باسم «${input.customer.slice(0, 60)}».`,
      );
    const balance = await this.services.sales.customerBalance(
      this.services.database,
      customer.id,
    );
    if (amount > balance) {
      return rejected(
        "exceeds_balance",
        `المبلغ أكبر من دين ${customer.name} (${formatIls(balance)}).`,
      );
    }
    return {
      status: "ready",
      operation: "customerPayment",
      args: { customerId: customer.id, amountAgorot: amount },
      summary: `دفعة ${formatIls(amount)} من ${customer.name}`,
      card: {
        title: "تسجيل دفعة من زبون",
        target: {
          label: customer.name,
          href: `/admin/customers/${customer.id}`,
        },
        rows: [
          { label: "المبلغ المستلم", before: null, after: formatIls(amount) },
          {
            label: "الرصيد",
            before: formatIls(balance),
            after: formatIls(balance - amount),
          },
        ],
        impact: [
          "تُسجّل الدفعة كقيد جديد في دفتر الزبون، ولا يُعدّل أي قيد سابق.",
        ],
        warnings: [],
        confirmLabel: "تأكيد الدفعة",
        destructive: true,
      },
    };
  }

  async prepareOrderCancellation(
    actor: AdminActor,
    input: { reference: string; reason: string },
  ): Promise<PrepareResult> {
    const reference = input.reference.trim();
    const order = await this.services.orders.getByPublicReference(
      actor,
      reference,
    );
    if (!order)
      return rejected(
        "not_found",
        `ما لقيت طلب برقم «${reference.slice(0, 30)}».`,
      );
    if (order.status === "delivered" || order.status === "cancelled") {
      return rejected(
        "invalid_transition",
        `الطلب ${order.publicReference} حالته «${orderStatusLabels[order.status]}» ولا يمكن إلغاؤه.`,
      );
    }
    const reason = input.reason.trim().slice(0, 180) || "إلغاء من المساعد";
    const reserved = order.items.some(
      (item) => item.stock.reservation === "active",
    );
    return {
      status: "ready",
      operation: "orderCancellation",
      args: { publicReference: order.publicReference, reason },
      summary: `إلغاء الطلب ${order.publicReference}`,
      card: {
        title: "إلغاء طلب",
        target: {
          label: `طلب ${order.publicReference}`,
          href: `/admin/orders/${order.publicReference}`,
        },
        rows: [
          {
            label: "الحالة",
            before: orderStatusLabels[order.status],
            after: orderStatusLabels.cancelled,
          },
          {
            label: "قيمة المنتجات",
            before: null,
            after: formatIls(order.itemsSubtotalAgorot),
          },
          { label: "السبب", before: null, after: reason },
        ],
        impact: reserved
          ? ["تُحرَّر الكميات المحجوزة لهذا الطلب وتعود متاحة للبيع."]
          : [],
        warnings: ["لا يمكن إعادة فتح الطلب بعد إلغائه."],
        confirmLabel: "تأكيد الإلغاء",
        destructive: true,
      },
    };
  }

  async preparePurchaseInvoiceImport(
    actor: AdminActor,
    input: { attachmentIds: string[] },
  ): Promise<PrepareResult> {
    if (!can(actor, "purchase.record"))
      return rejected("forbidden", "لا تملكين صلاحية تسجيل المشتريات.");
    const ids = [...new Set(input.attachmentIds)].slice(0, 6);
    const rows = await Promise.all(
      ids.map((id) => this.services.attachments.get(actor, id)),
    );
    if (!ids.length || rows.some((row) => !row)) {
      return rejected("attachment_missing", "أرفقي صور الفاتورة أولاً.");
    }
    const pdfs = rows.filter(
      (row) => row!.mimeType === "application/pdf",
    ).length;
    if (pdfs > 1 || (pdfs === 1 && rows.length > 1)) {
      return rejected(
        "invalid_input",
        "أرسلي ملف PDF واحد أو حتى 6 صور للفاتورة.",
      );
    }
    return {
      status: "ready",
      operation: "purchaseInvoiceImport",
      args: { attachmentIds: ids },
      summary: "قراءة فاتورة شراء",
      card: {
        title: "قراءة فاتورة شراء",
        target: { label: `${ids.length} صفحة`, href: null },
        rows: [],
        impact: [
          "ستُقرأ الفاتورة آلياً وتُفتح شاشة مراجعة البنود.",
          "لا يُضاف شيء للمخزون قبل مراجعتك وتأكيدك في تلك الشاشة.",
        ],
        warnings: [],
        confirmLabel: "قراءة الفاتورة",
        destructive: false,
      },
    };
  }

  private buildHandlers() {
    const s = this.services;
    const database = s.database;
    const productUpdate: Handler<{
      domainId: string;
      changes: Partial<
        Pick<
          AdminProductUpdate,
          | "nameAr"
          | "categoryId"
          | "unit"
          | "priceAgorot"
          | "availability"
          | "description"
        >
      > & { latinName?: string | null };
    }> = {
      args: z.object({
        domainId: z.string(),
        changes: z
          .object({
            nameAr: z.string().min(2).max(160).optional(),
            latinName: z.string().max(120).nullable().optional(),
            description: z.string().max(4_000).optional(),
            categoryId: categoryCodeSchema.optional(),
            unit: z.string().max(80).optional(),
            priceAgorot: z.number().int().positive().optional(),
            availability: z.enum(["available", "unavailable"]).optional(),
          })
          .strict(),
      }),
      version: (_actor, args) => productVersion(database, args.domainId),
      async execute(actor, args) {
        const product = await s.catalog.getByDomainId(actor, args.domainId);
        if (!product) throw new Error("not_found");
        const next = { ...args.changes };
        const latinName =
          next.latinName === undefined
            ? product.latinName
            : (next.latinName ?? undefined);
        const description =
          next.description === undefined
            ? product.description
            : next.description || undefined;
        const unit =
          next.unit === undefined ? product.unit : next.unit || undefined;
        await s.catalog.update(actor, {
          domainId: product.id,
          nameAr: next.nameAr ?? product.nameAr,
          latinName,
          priceAgorot: next.priceAgorot ?? product.priceAgorot,
          categoryId: next.categoryId ?? product.categoryId,
          availability: next.availability ?? product.availability,
          sortOrder: product.sortOrder,
          description,
          usageNotes: product.usageNotes,
          unit,
          detailsStatus: product.detailsStatus,
          placeholderVariant:
            product.image.kind === "placeholder"
              ? product.image.variant
              : "general-cleaner",
        });
        return {
          message: `تم تعديل ${next.nameAr ?? product.nameAr}.`,
          href: productHref(product.id),
          ref: `product:${product.id}`,
        };
      },
    };

    const productImageReplacement: Handler<{
      domainId: string;
      attachmentId: string;
    }> = {
      args: z.object({ domainId: z.string(), attachmentId: z.uuid() }),
      version: (_actor, args) => productVersion(database, args.domainId),
      async execute(actor, args) {
        const file = await s.attachments.read(actor, args.attachmentId);
        if (!file) throw new Error("attachment_missing");
        const webp = await sharp(file.bytes)
          .resize(1_200, 1_200, { fit: "inside", withoutEnlargement: true })
          .webp({ quality: 88 })
          .toBuffer();
        const stored = await s.productImages().put(webp);
        await s.catalog.setImage(actor, {
          domainId: args.domainId,
          image: stored,
        });
        await s.attachments.markUsed(args.attachmentId);
        return {
          message: "تم استبدال صورة المنتج.",
          href: productHref(args.domainId),
          ref: `product:${args.domainId}`,
        };
      },
    };

    const productArchive: Handler<{
      domainId: string;
      mode: "archive" | "delete";
      reason: string;
    }> = {
      args: z.object({
        domainId: z.string(),
        mode: z.enum(["archive", "delete"]),
        reason: z.string().max(200),
      }),
      async version(actor, args) {
        const version = await productVersion(database, args.domainId);
        const references = await s.maintenance.references(actor, args.domainId);
        if (!version || !references) return null;
        return `${version}|${canonicalJson(references)}`;
      },
      async execute(actor, args) {
        if (args.mode === "delete") {
          await s.maintenance.deleteUnreferenced(actor, args.domainId);
          return {
            message: "تم حذف المنتج نهائياً.",
            href: "/admin/products",
            ref: `product:${args.domainId}`,
          };
        }
        await s.maintenance.archive(actor, {
          domainId: args.domainId,
          reason: args.reason,
        });
        return {
          message: "تمت أرشفة المنتج؛ اختفى من المتجر وبقي تاريخه.",
          href: productHref(args.domainId),
          ref: `product:${args.domainId}`,
        };
      },
    };

    const productMerge: Handler<{
      sourceDomainId: string;
      targetDomainId: string;
    }> = {
      args: z.object({
        sourceDomainId: z.string(),
        targetDomainId: z.string(),
      }),
      async version(_actor, args) {
        const [source, target, stock] = await Promise.all([
          productVersion(database, args.sourceDomainId),
          productVersion(database, args.targetDomainId),
          s.maintenance.onHandByVariant(args.sourceDomainId),
        ]);
        if (!source || !target) return null;
        return sha256(canonicalJson({ source, target, stock }));
      },
      async execute(actor, args, key) {
        const result = await s.maintenance.merge(actor, {
          idempotencyKey: key,
          sourceDomainId: args.sourceDomainId,
          targetDomainId: args.targetDomainId,
        });
        return {
          message: `تم الدمج${result.movedVariants ? " ونقل الكمية" : ""}.`,
          href: productHref(args.targetDomainId),
          ref: `product:${args.targetDomainId}`,
        };
      },
    };

    const variantStockVersion = async (
      actor: AdminActor,
      variantId: string,
    ) => {
      const detail = await s.inventory.getVariantStock(actor, variantId);
      if (!detail) return null;
      return `${detail.stock.onHandMilli}:${detail.stock.reservedMilli}:${detail.stock.reorderThresholdMilli ?? "-"}:${detail.stock.lastMovementAt ?? "-"}`;
    };

    const inventoryCorrection: Handler<{
      variantId: string;
      reason: "correction" | "damaged" | "expired";
      quantityMilli: number;
      note?: string;
    }> = {
      args: z.object({
        variantId: z.string(),
        reason: z.enum(["correction", "damaged", "expired"]),
        quantityMilli: z.number().int().min(0),
        note: z.string().max(200).optional(),
      }),
      version: (actor, args) => variantStockVersion(actor, args.variantId),
      async execute(actor, args, key) {
        const result = await s.inventory.adjust(actor, {
          idempotencyKey: key,
          variantId: args.variantId,
          reason: args.reason,
          quantityMilli: args.quantityMilli,
          note: args.note,
        });
        return {
          message: `تم تعديل المخزون. الكمية الآن ${quantityText(result.onHandMilli)}.`,
          href: stockHref(args.variantId),
          ref: `variant:${args.variantId}`,
        };
      },
    };

    const stockTransfer: Handler<{
      fromVariantId: string;
      toVariantId: string;
      quantityMilli: number;
    }> = {
      args: z.object({
        fromVariantId: z.string(),
        toVariantId: z.string(),
        quantityMilli: z.number().int().positive(),
      }),
      async version(actor, args) {
        const [from, to] = await Promise.all([
          variantStockVersion(actor, args.fromVariantId),
          variantStockVersion(actor, args.toVariantId),
        ]);
        return from && to ? `${from}|${to}` : null;
      },
      async execute(actor, args, key) {
        const result = await s.inventory.transfer(actor, {
          idempotencyKey: key,
          fromVariantId: args.fromVariantId,
          toVariantId: args.toVariantId,
          quantityMilli: args.quantityMilli,
        });
        return {
          message: `تم النقل. المصدر الآن ${quantityText(result.fromOnHandMilli)} والوجهة ${quantityText(result.toOnHandMilli)}.`,
          href: stockHref(args.toVariantId),
          ref: `variant:${args.toVariantId}`,
        };
      },
    };

    const reorderThreshold: Handler<{
      variantId: string;
      thresholdMilli: number | null;
    }> = {
      args: z.object({
        variantId: z.string(),
        thresholdMilli: z.number().int().min(0).nullable(),
      }),
      version: (actor, args) => variantStockVersion(actor, args.variantId),
      async execute(actor, args) {
        await s.inventory.setReorderThreshold(actor, args);
        return {
          message: "تم حفظ حد إعادة الطلب.",
          href: stockHref(args.variantId),
          ref: `variant:${args.variantId}`,
        };
      },
    };

    const saleArgs = z.object({
      customerId: z.uuid().optional(),
      customerName: z.string().min(2).max(100).optional(),
      source: z.literal("assistant"),
      lines: z
        .array(
          z.object({
            variantId: z.string(),
            sellingUnitId: z.uuid().optional(),
            quantityMilli: z.number().int().positive(),
            unitPriceAgorot: z.number().int().min(0),
          }),
        )
        .min(1),
      discountAgorot: z.number().int().min(0),
      paidAgorot: z.number().int().min(0),
    });
    const manualSale: Handler<z.infer<typeof saleArgs>> = {
      args: saleArgs,
      async version(actor, args) {
        const preview = await s.sales.preview(actor, {
          ...args,
          idempotencyKey: crypto.randomUUID(),
        });
        if (preview.blocked) return null;
        return sha256(
          canonicalJson({
            totals: preview.totals,
            balance: preview.balance,
            lines: preview.lines.map((line) => [
              line.variantId,
              line.sellingUnitId,
              line.unitsPerSale,
              line.lineTotalAgorot,
            ]),
          }),
        );
      },
      async execute(actor, args, key) {
        const result = await s.sales.post(actor, {
          ...args,
          idempotencyKey: key,
        });
        return {
          message: `تم حفظ البيع، فاتورة رقم ${result.invoiceNumber} بقيمة ${formatIls(result.totalAgorot)}.`,
          href: `/admin/sales/${result.invoiceId}`,
          ref: `customer_invoice:${result.invoiceId}`,
        };
      },
    };

    const customerPayment: Handler<{
      customerId: string;
      amountAgorot: number;
    }> = {
      args: z.object({
        customerId: z.uuid(),
        amountAgorot: z.number().int().positive(),
      }),
      async version(_actor, args) {
        return String(await s.sales.customerBalance(database, args.customerId));
      },
      async execute(actor, args, key) {
        const result = await s.sales.recordPayment(actor, {
          customerId: args.customerId,
          amountAgorot: args.amountAgorot,
          idempotencyKey: key,
        });
        return {
          message: `تم تسجيل الدفعة. الرصيد الآن ${formatIls(result.balanceAgorot)}.`,
          href: `/admin/customers/${args.customerId}`,
          ref: `customer:${args.customerId}`,
        };
      },
    };

    const orderCancellation: Handler<{
      publicReference: string;
      reason: string;
    }> = {
      args: z.object({
        publicReference: z.string(),
        reason: z.string().max(180),
      }),
      async version(actor, args) {
        const order = await s.orders.getByPublicReference(
          actor,
          args.publicReference,
        );
        return order ? String(order.version) : null;
      },
      async execute(actor, args, _key, version) {
        // The version confirmed by the user is the one the transition must still match.
        await s.orders.changeStatus(actor, {
          publicReference: args.publicReference,
          nextStatus: "cancelled",
          expectedVersion: Number(version),
          reason: args.reason,
        });
        return {
          message: `تم إلغاء الطلب ${args.publicReference}.`,
          href: `/admin/orders/${args.publicReference}`,
          ref: `order:${args.publicReference}`,
        };
      },
    };

    const purchaseInvoiceImport: Handler<{ attachmentIds: string[] }> = {
      args: z.object({ attachmentIds: z.array(z.uuid()).min(1).max(6) }),
      async version(actor, args) {
        const rows = await Promise.all(
          args.attachmentIds.map((id) => s.attachments.get(actor, id)),
        );
        return rows.every(Boolean) ? args.attachmentIds.join(",") : null;
      },
      async execute(actor, args, key) {
        const files = [];
        for (const id of args.attachmentIds) {
          const file = await s.attachments.read(actor, id);
          if (!file) throw new Error("attachment_missing");
          files.push({ bytes: file.bytes, name: file.name });
        }
        const job = await s.extraction.createInvoiceJob(
          actor,
          { files, idempotencyKey: key },
          s.invoiceExtractor(),
        );
        await Promise.all(
          args.attachmentIds.map((id) => s.attachments.markUsed(id)),
        );
        return {
          message:
            "تمت قراءة الفاتورة. افتحي شاشة المراجعة لتأكيد البنود قبل الحفظ.",
          href: `/admin/inventory/review/${job.jobId}`,
          ref: `extraction_job:${job.jobId}`,
        };
      },
    };

    return {
      productUpdate,
      productImageReplacement,
      productArchive,
      productMerge,
      inventoryCorrection,
      stockTransfer,
      reorderThreshold,
      manualSale,
      customerPayment,
      orderCancellation,
      purchaseInvoiceImport,
    };
  }
}
