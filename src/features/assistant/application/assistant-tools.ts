import "server-only";

import { tool } from "ai";
import { z } from "zod";

import {
  prepareState,
  type MutationState,
} from "@/features/assistant/domain/result-state";

import type { AdminOrderService } from "@/features/admin/application/admin-order-service";
import type { AdminActor } from "@/features/admin/domain/admin-actor";
import { can } from "@/features/admin/domain/permissions";
import type { InventoryService } from "@/features/inventory/application/inventory-service";
import { formatQuantity } from "@/features/inventory/domain/quantity";
import { stockUnitLabels } from "@/features/inventory/domain/stock-constants";
import {
  isOrderStatus,
  orderStatusLabels,
} from "@/features/orders/domain/order-status";
import type { PurchaseService } from "@/features/purchasing/application/purchase-service";
import type { ReportService } from "@/features/reports/application/report-service";
import {
  reportPresetLabels,
  resolvePeriod,
} from "@/features/reports/domain/report-calculation";
import type { CustomerService } from "@/features/sales/application/customer-service";
import type { SalesService } from "@/features/sales/application/sales-service";
import { formatIls } from "@/shared/lib/format-currency";
import { normalizeArabicText } from "@/shared/lib/normalize-arabic";
import { todayInStoreZone } from "@/shared/lib/store-time";
import type { Database } from "@/features/inventory/application/stock-ledger";

import { toolRisk, type AssistantMode } from "../domain/assistant-policy";
import { forSearch, resolveCatalogEntity } from "../domain/entity-match";
import { assistantFailure } from "./assistant-errors";
import {
  catalogEntries,
  type AssistantOperations,
  type PrepareResult,
} from "./assistant-operations";
import type { ConfirmationService } from "./confirmation-service";
import type { ToolRunLog } from "./tool-run-log";
import type { AdminCatalogService } from "@/features/admin/application/admin-catalog-service";
import type { CatalogAuthoringService } from "@/features/admin/application/catalog-authoring-service";
import type { ProductImageAnalyzer } from "@/server/ai/product-image-analyzer";

import type { AttachmentService } from "./attachment-service";
import {
  confirmationButtonHint,
  isExecutionDemand,
} from "../domain/affirmation";
import { amountRefusal, missingAmountClarification } from "./amount-refusal";
import { createCatalogTools } from "./catalog-tools";
import { createPartyTools } from "./party-tools";
import { createMediaTools } from "./media-tools";
import { createSellingUnitTools } from "./selling-unit-tools";
import type { OfferService } from "@/features/offers/application/offer-service";
import type { SupplierMaintenanceService } from "@/features/purchasing/application/supplier-maintenance-service";
import type { SupplierService } from "@/features/purchasing/application/supplier-service";
import type { CustomerMaintenanceService } from "@/features/sales/application/customer-maintenance-service";

export interface AssistantToolContext {
  actor: AdminActor;
  /** The owner's latest message as typed; amount checks read it, never the model's arguments. */
  ownerText?: () => string;
  conversationId: string;
  mode: AssistantMode;
  database: Database;
  catalog: AdminCatalogService;
  authoring: CatalogAuthoringService;
  attachments: AttachmentService;
  imageAnalyzer: () => ProductImageAnalyzer;
  offers: OfferService;
  customerMaintenance: CustomerMaintenanceService;
  suppliers: SupplierService;
  supplierMaintenance: SupplierMaintenanceService;
  inventory: InventoryService;
  orders: AdminOrderService;
  customers: CustomerService;
  sales: SalesService;
  reports: ReportService;
  purchases: PurchaseService;
  operations: AssistantOperations;
  confirmations: ConfirmationService;
  toolRuns: ToolRunLog;
}

const text = (max: number) => z.string().trim().min(1).max(max);
const period = z
  .enum(["today", "week", "last14", "month"])
  .describe(
    "today=اليوم، week=هذا الأسبوع، last14=آخر 14 يوماً، month=هذا الشهر",
  );
const ownerOnly = {
  status: "forbidden" as const,
  message: "هذه المعلومة للمالك فقط.",
};

export type PrepareToolOutput = (
  | {
      status: "awaiting_confirmation";
      confirmationId: string;
      summary: string;
      expiresAt: string;
    }
  | Exclude<PrepareResult, { status: "ready" }>
  | { status: "error"; code: string; message: string }
) & { state?: MutationState };

export function createAssistantTools(context: AssistantToolContext) {
  const { actor } = context;

  async function run<T>(
    name: string,
    input: unknown,
    action: () => Promise<T>,
    reference?: (result: T) => string | null,
  ): Promise<T | { status: "error"; code: string; message: string }> {
    const started = Date.now();
    try {
      const result = await action();
      await context.toolRuns.record({
        conversationId: context.conversationId,
        adminUserId: actor.id,
        toolName: name,
        riskLevel: toolRisk(name),
        status: "succeeded",
        input,
        resultRef: reference?.(result) ?? null,
        durationMs: Date.now() - started,
      });
      return result;
    } catch (error) {
      const failure = assistantFailure(error);
      await context.toolRuns.record({
        conversationId: context.conversationId,
        adminUserId: actor.id,
        toolName: name,
        riskLevel: toolRisk(name),
        status: "failed",
        input,
        errorCode: failure.code,
        durationMs: Date.now() - started,
      });
      return { status: "error", code: failure.code, message: failure.message };
    }
  }

  // A prepare tool only stores a pending card; executing it needs the person's tap on that card.
  const prepare = (
    name: string,
    input: unknown,
    build: () => Promise<PrepareResult>,
  ) =>
    run<PrepareToolOutput>(
      name,
      input,
      async () => {
        const refused = amountRefusal(context, input);
        if (refused) return { ...refused, state: prepareState(refused) };
        // Typing "go ahead" while a card is open points at its button; it never makes another card.
        if (isExecutionDemand(context.ownerText?.() ?? "")) {
          const open = await context.confirmations.pendingInConversation(
            actor,
            context.conversationId,
          );
          if (open) {
            const pending = {
              status: "rejected" as const,
              code: "card_pending",
              message: confirmationButtonHint(open.confirmLabel),
            };
            return { ...pending, state: prepareState(pending) };
          }
        }
        const prepared = await build();
        if (prepared.status !== "ready") {
          return { ...prepared, state: prepareState(prepared) };
        }
        const created = await context.confirmations.create(
          actor,
          context.conversationId,
          prepared,
          context.ownerText?.(),
        );
        if (!created) {
          return {
            status: "error",
            code: "database_conflict",
            message: "تغيّرت البيانات أثناء التجهيز، حاولي مرة أخرى.",
            state: "confirmation_failed",
          };
        }
        return {
          status: "awaiting_confirmation",
          confirmationId: created.confirmationId,
          summary: prepared.summary,
          expiresAt: created.expiresAt,
          state: "ready_for_confirmation",
        };
      },
      (result) =>
        result.status === "awaiting_confirmation"
          ? `confirmation:${result.confirmationId}`
          : null,
    );

  async function matchingSuppliers(name: string) {
    if (!can(actor, "suppliers.manage")) return [];
    const needle = normalizeArabicText(name);
    return (await context.suppliers.list(actor))
      .filter((row) => {
        const supplier = normalizeArabicText(row.nameAr);
        return supplier.includes(needle) || needle.includes(supplier);
      })
      .slice(0, 5)
      .map((row) => ({ supplierId: row.id, name: row.nameAr }));
  }

  const catalogTools = createCatalogTools(context, run, prepare);
  const partyTools = createPartyTools(context, run, prepare);
  const mediaTools = createMediaTools(context, run, prepare);
  const sellingUnitTools = createSellingUnitTools(context, run, prepare);

  const read = {
    ...catalogTools.read,
    ...partyTools.read,
    ...mediaTools.read,
    ...sellingUnitTools.read,
    searchProducts: tool({
      description:
        "ابحث عن منتج بالاسم العربي أو اللاتيني أو الباركود أو SKU. يعيد منتجاً محدداً أو خيارات قريبة للاختيار.",
      inputSchema: z.object({ query: text(120) }).strict(),
      execute: ({ query }) =>
        run("searchProducts", { query }, async () => {
          const [products, archivedProducts] = await Promise.all([
            context.catalog.list(actor),
            context.catalog.listArchived(actor),
          ]);
          const resolution = forSearch(
            resolveCatalogEntity(query, catalogEntries(products), "product"),
          );
          const list =
            resolution.status === "resolved"
              ? [resolution.match]
              : resolution.candidates;
          const stock = await context.inventory.listStock(actor);
          // Archived products are reported apart, only when nothing active matched, so they can be restored by id.
          const archived =
            resolution.status === "resolved" && !resolution.approximate
              ? []
              : (() => {
                  const entries = catalogEntries(archivedProducts);
                  const found = resolveCatalogEntity(query, entries, "product");
                  const rows =
                    found.status === "resolved"
                      ? [found.match]
                      : found.candidates;
                  return [
                    ...new Map(
                      rows.map((row) => [row.productId, row]),
                    ).values(),
                  ]
                    .slice(0, 5)
                    .map((row) => ({
                      productId: row.productId,
                      label: row.label,
                      href: `/admin/products/${row.productId}`,
                    }));
                })();
          return {
            status: resolution.status,
            approximate: resolution.approximate,
            // The target is settled; asking "shall I?" before a card only delays the card that already asks.
            ...(resolution.status === "resolved" && !resolution.approximate
              ? {
                  next: "هذا هو المنتج المطلوب. إذا طلبت المستخدمة تعديلاً عليه فجهّز البطاقة الآن بأداة prepare المناسبة، ومرّر القيم كما كتبتها؛ البطاقة نفسها خطوة التأكيد والخادم يرفض القيم غير الصالحة. لا تبحث عن القيمة الجديدة (رمز أو سعر) كمنتج.",
                }
              : {}),
            ...(archived.length
              ? {
                  archived,
                  archivedNote:
                    "منتجات مؤرشفة غير ظاهرة في المتجر. لاسترجاع أحدها استعمل prepareProductRestore بمعرّفه.",
                }
              : {}),
            results: list.map((item) => {
              const product = products.find(
                (row) => row.id === item.productId,
              )!;
              const row = stock.find(
                (entry) => entry.variantId === item.variantId,
              );
              return {
                productId: item.productId,
                variantId: item.variantId,
                label: item.label,
                confidence: item.confidence,
                variantCount: product.variants.length,
                price: formatIls(product.priceAgorot),
                availability:
                  product.availability === "available"
                    ? "متوفر للبيع"
                    : "غير متوفر",
                stock: row?.tracked
                  ? `${formatQuantity(row.availableMilli)} ${stockUnitLabels[row.unit]}`
                  : "غير متتبَّع",
                href: `/admin/products/${item.productId}`,
              };
            }),
          };
        }),
    }),
    getProductDetails: tool({
      description:
        "تفاصيل منتج محدد بمعرّفه (productId) كما أعاده searchProducts.",
      inputSchema: z.object({ productId: text(80) }).strict(),
      execute: ({ productId }) =>
        run("getProductDetails", { productId }, async () => {
          const product = await context.catalog.getByDomainId(actor, productId);
          if (!product) return { status: "not_found" as const };
          const [categories, archivedVariants] = await Promise.all([
            context.authoring.listCategories(true),
            context.authoring.archivedVariants(product.id),
          ]);
          return {
            status: "found" as const,
            productId: product.id,
            nameAr: product.nameAr,
            latinName: product.latinName ?? null,
            category:
              categories.find((row) => row.code === product.categoryId)
                ?.nameAr ?? product.categoryId,
            unit: product.unit ?? null,
            price: formatIls(product.priceAgorot),
            availability: product.availability,
            publication: product.archived ? "archived" : product.publication,
            slug: product.slug,
            sortOrder: product.sortOrder,
            description: product.description?.slice(0, 300) ?? null,
            specifications: product.specifications.map((row) => ({
              label: row.labelAr,
              value: row.valueAr,
            })),
            variants: product.variants.map((variant) => ({
              variantId: variant.id,
              label: variant.labelAr,
              price: formatIls(variant.priceAgorot),
              availability: variant.availability,
              isDefault: variant.isDefault,
              attributes: variant.attributes,
              sku: variant.sku ?? null,
              barcode: variant.barcode ?? null,
            })),
            archivedVariants: archivedVariants.map((row) => ({
              variantId: row.variantId,
              label: row.labelAr,
            })),
            imageUrl: product.image.kind === "image" ? product.image.src : null,
            href: `/admin/products/${product.id}`,
          };
        }),
    }),
    getInventoryItem: tool({
      description:
        "المخزون الحالي لصنف (variantId): الموجود، المحجوز، المتاح، والتكلفة للمالك، وآخر الحركات.",
      inputSchema: z.object({ variantId: text(100) }).strict(),
      execute: ({ variantId }) =>
        run("getInventoryItem", { variantId }, async () => {
          const detail = await context.inventory.getVariantStock(
            actor,
            variantId,
          );
          if (!detail) return { status: "not_found" as const };
          const { stock } = detail;
          const unit = stockUnitLabels[stock.unit];
          return {
            status: "found" as const,
            name: stock.name,
            tracked: stock.tracked,
            onHand: `${formatQuantity(stock.onHandMilli)} ${unit}`,
            reserved: `${formatQuantity(stock.reservedMilli)} ${unit}`,
            available: `${formatQuantity(stock.availableMilli)} ${unit}`,
            salePrice: formatIls(stock.salePriceAgorot),
            averageCost:
              stock.avgCostAgorot === null
                ? null
                : formatIls(stock.avgCostAgorot),
            stockValue:
              stock.stockValueAgorot === null
                ? null
                : formatIls(stock.stockValueAgorot),
            unitProfit:
              stock.unitProfitAgorot === null
                ? null
                : formatIls(stock.unitProfitAgorot),
            reorderAt:
              stock.reorderThresholdMilli === null
                ? null
                : formatQuantity(stock.reorderThresholdMilli),
            recentMovements: detail.movements.slice(0, 5).map((movement) => ({
              change: formatQuantity(movement.qtyDeltaMilli),
              after: formatQuantity(movement.onHandAfterMilli),
              at: movement.createdAt,
            })),
            href: `/admin/inventory/stock/${stock.variantId}`,
          };
        }),
    }),
    getInventorySummary: tool({
      description:
        "ملخص المخزون: قيمة البضاعة الحالية وعدد الأصناف القليلة والنافدة.",
      inputSchema: z.object({}).strict(),
      execute: () =>
        run("getInventorySummary", {}, async () => {
          const overview = await context.inventory.getOverview(actor);
          return {
            trackedItems: overview.trackedCount,
            lowCount: overview.lowCount,
            outCount: overview.outCount,
            inventoryValue:
              overview.inventoryValueAgorot === null
                ? null
                : formatIls(overview.inventoryValueAgorot),
            href: "/admin/inventory",
          };
        }),
    }),
    getLowStockItems: tool({
      description: "الأصناف التي قاربت على النفاد أو نفدت ويجب طلبها.",
      inputSchema: z.object({}).strict(),
      execute: () =>
        run("getLowStockItems", {}, async () => {
          const items = await context.inventory.listStock(actor, {
            filter: "attention",
          });
          return {
            count: items.length,
            items: items.slice(0, 15).map((item) => ({
              variantId: item.variantId,
              name: item.variantLabel
                ? `${item.name} — ${item.variantLabel}`
                : item.name,
              available: `${formatQuantity(item.availableMilli)} ${stockUnitLabels[item.unit]}`,
              status: item.status === "out" ? "نفد" : "قليل",
            })),
            href: "/admin/inventory/stock?filter=attention",
          };
        }),
    }),
    searchOrders: tool({
      description:
        "ابحث في طلبات المتجر برقم الطلب أو اسم الزبون أو الحالة. يعيد آخر 10 نتائج.",
      inputSchema: z
        .object({
          reference: z.string().trim().max(30).optional(),
          customerName: z.string().trim().max(80).optional(),
          status: z
            .enum([
              "pending",
              "confirmed",
              "preparing",
              "out_for_delivery",
              "delivered",
              "cancelled",
            ])
            .optional(),
        })
        .strict(),
      execute: (input) =>
        run("searchOrders", input, async () => {
          const result = await context.orders.list(actor, {
            page: 1,
            ...(input.status && isOrderStatus(input.status)
              ? { status: input.status }
              : {}),
            ...(input.reference
              ? { publicReference: input.reference.trim() }
              : {}),
            ...(input.customerName ? { customerName: input.customerName } : {}),
          });
          return {
            total: result.total,
            orders: result.items.slice(0, 10).map((order) => ({
              reference: order.publicReference,
              status: orderStatusLabels[order.status],
              customer: order.customerName,
              total: formatIls(
                order.finalTotalAgorot ?? order.itemsSubtotalAgorot,
              ),
              createdAt: order.createdAt,
              href: `/admin/orders/${order.publicReference}`,
            })),
          };
        }),
    }),
    getOrderDetails: tool({
      description: "تفاصيل طلب برقمه.",
      inputSchema: z.object({ reference: text(30) }).strict(),
      execute: ({ reference }) =>
        run("getOrderDetails", { reference }, async () => {
          const order = await context.orders.getByPublicReference(
            actor,
            reference.trim(),
          );
          if (!order) return { status: "not_found" as const };
          return {
            status: "found" as const,
            reference: order.publicReference,
            orderStatus: orderStatusLabels[order.status],
            customer: order.customerName,
            area: order.serviceAreaName,
            items: order.items.map((item) => ({
              name: item.variantLabel
                ? `${item.productName} — ${item.variantLabel}`
                : item.productName,
              quantity: item.quantity,
              total: formatIls(item.lineSubtotalAgorot),
            })),
            itemsTotal: formatIls(order.itemsSubtotalAgorot),
            finalTotal:
              order.finalTotalAgorot === null
                ? null
                : formatIls(order.finalTotalAgorot),
            createdAt: order.createdAt,
            href: `/admin/orders/${order.publicReference}`,
          };
        }),
    }),
    searchCustomers: tool({
      description:
        "ابحث عن زبون بالاسم، مع رصيده الحالي. إذا لم يوجد زبون بالاسم وكان هناك مورد بنفس الاسم يعيده في suppliers.",
      inputSchema: z.object({ name: text(80) }).strict(),
      execute: ({ name }) =>
        run("searchCustomers", { name }, async () => {
          const rows = await context.customers.list(actor, { search: name });
          // A name alone does not say customer or supplier ("كشف حساب شركة النور"); say where it was found.
          const suppliers = rows.length ? [] : await matchingSuppliers(name);
          return {
            status:
              rows.length > 1
                ? ("ambiguous" as const)
                : rows.length
                  ? ("found" as const)
                  : ("not_found" as const),
            customers: rows.slice(0, 8).map((row) => ({
              customerId: row.id,
              name: row.name,
              balance: formatIls(row.balanceAgorot),
              href: `/admin/customers/${row.id}`,
            })),
            ...(suppliers.length
              ? {
                  suppliers,
                  note: "لا يوجد زبون بهذا الاسم، لكنه اسم مورد. استعمل أدوات الموردين (getSupplierStatement أو getSupplierDetails).",
                }
              : {}),
          };
        }),
    }),
    getCustomerBalance: tool({
      description: "رصيد زبون محدد (customerId) وآخر فواتيره غير المدفوعة.",
      inputSchema: z.object({ customerId: z.uuid() }).strict(),
      execute: ({ customerId }) =>
        run("getCustomerBalance", { customerId }, async () => {
          const detail = await context.customers.getDetail(actor, customerId);
          if (!detail) return { status: "not_found" as const };
          return {
            status: "found" as const,
            name: detail.name,
            balance: formatIls(detail.summary.balanceAgorot),
            oldestUnpaidDays: detail.summary.oldestUnpaid?.ageDays ?? null,
            href: `/admin/customers/${detail.id}`,
          };
        }),
    }),
    getDebtors: tool({
      description: "الزبائن الذين عليهم ديون، مرتبين حسب المبلغ وأقدم دين.",
      inputSchema: z.object({}).strict(),
      execute: () =>
        run("getDebtors", {}, async () => {
          if (!can(actor, "reports.view")) return ownerOnly;
          const debtors = await context.reports.listDebtors(actor);
          return {
            count: debtors.length,
            total: formatIls(
              debtors.reduce((sum, row) => sum + row.balanceAgorot, 0),
            ),
            debtors: debtors.slice(0, 15).map((row) => ({
              customerId: row.id,
              name: row.name,
              balance: formatIls(row.balanceAgorot),
              oldestDebtDays: row.oldestDays,
            })),
            href: "/admin/customers?filter=owing",
          };
        }),
    }),
    getPurchaseInvoice: tool({
      description:
        "آخر فواتير الشراء، أو فاتورة محددة بمعرّفها (invoiceId) أو برقمها المكتوب عليها (reference مثل INV-7781).",
      inputSchema: z
        .object({
          invoiceId: z.uuid().optional(),
          reference: text(60).optional(),
        })
        .strict(),
      execute: ({ invoiceId: requestedId, reference }) =>
        run(
          "getPurchaseInvoice",
          { invoiceId: requestedId, reference },
          async () => {
            let invoiceId = requestedId;
            if (!invoiceId && reference) {
              const normalize = (value: string) =>
                value.replace(/\s+/g, "").toLowerCase();
              const wanted = normalize(reference);
              const matches = (await context.purchases.list(actor, 200)).filter(
                (row) => row.reference && normalize(row.reference) === wanted,
              );
              if (!matches.length) return { status: "not_found" as const };
              if (matches.length > 1) {
                return {
                  status: "needs_selection" as const,
                  invoices: matches.slice(0, 8).map((row) => ({
                    invoiceId: row.id,
                    supplier: row.supplierName,
                    date: row.invoiceDate,
                  })),
                };
              }
              invoiceId = matches[0]!.id;
            }
            if (!invoiceId) {
              const list = await context.purchases.list(actor, 8);
              return {
                invoices: list.map((row) => ({
                  invoiceId: row.id,
                  supplier: row.supplierName,
                  reference: row.reference,
                  date: row.invoiceDate,
                  total:
                    row.totalAgorot === null
                      ? null
                      : formatIls(row.totalAgorot),
                  href: `/admin/inventory/purchases/${row.id}`,
                })),
              };
            }
            const detail = await context.purchases.getDetail(actor, invoiceId);
            if (!detail) return { status: "not_found" as const };
            return {
              status: "found" as const,
              invoiceId,
              supplier: detail.supplierName,
              reference: detail.reference,
              date: detail.invoiceDate,
              total:
                detail.totalAgorot === null
                  ? null
                  : formatIls(detail.totalAgorot),
              lines: detail.lines.slice(0, 30).map((line) => ({
                name: line.name,
                quantity: formatQuantity(line.quantityMilli),
                lineTotal:
                  line.lineTotalAgorot === null
                    ? null
                    : formatIls(line.lineTotalAgorot),
              })),
              href: `/admin/inventory/purchases/${invoiceId}`,
            };
          },
        ),
    }),
    getSalesSummary: tool({
      description:
        "المبيعات لفترة: صافي المبيعات وعدد العمليات وأكثر المنتجات مبيعاً.",
      inputSchema: z.object({ period }).strict(),
      execute: ({ period: preset }) =>
        run("getSalesSummary", { preset }, async () => {
          if (!can(actor, "reports.view")) return ownerOnly;
          const report = await context.reports.getReport(
            actor,
            resolvePeriod(preset, todayInStoreZone()),
          );
          return {
            period: reportPresetLabels[preset],
            netSales: formatIls(report.metrics.netSalesAgorot),
            orderCount: report.metrics.orderCount,
            topByQuantity: report.byQuantity.slice(0, 3).map((row) => ({
              name: row.name,
              quantity: formatQuantity(row.quantityMilli),
              sales: formatIls(row.netSalesAgorot),
            })),
            href: `/admin/reports?preset=${preset}`,
          };
        }),
    }),
    getProfitSummary: tool({
      description:
        "الربح الإجمالي لفترة وأعلى المنتجات ربحاً، مع تنبيه إن كانت تكلفة بعض المبيعات غير مسجّلة.",
      inputSchema: z.object({ period }).strict(),
      execute: ({ period: preset }) =>
        run("getProfitSummary", { preset }, async () => {
          if (!can(actor, "reports.view")) return ownerOnly;
          const report = await context.reports.getReport(
            actor,
            resolvePeriod(preset, todayInStoreZone()),
          );
          const { metrics } = report;
          return {
            period: reportPresetLabels[preset],
            grossProfit: formatIls(metrics.grossProfitAgorot),
            netSales: formatIls(metrics.netSalesAgorot),
            costComplete: metrics.costComplete,
            uncostedSales: metrics.costComplete
              ? null
              : formatIls(metrics.uncostedSalesAgorot),
            topByProfit: report.byProfit.slice(0, 3).map((row) => ({
              name: row.name,
              profit:
                row.profitAgorot === null ? null : formatIls(row.profitAgorot),
            })),
            href: `/admin/reports?preset=${preset}`,
          };
        }),
    }),
  };

  if (context.mode !== "full") return read;

  const ops = context.operations;
  const product = text(160).describe(
    "اسم المنتج كما قالته المستخدمة، أو productId إن كان معروفاً",
  );
  const quantity = z
    .string()
    .trim()
    .min(1)
    .max(12)
    .describe('الكمية بالأرقام كنص مثل "3" أو "2.5"');
  const money = z
    .string()
    .trim()
    .min(1)
    .max(40)
    .describe(
      'المبلغ كما كتبته المستخدمة حرفياً، مثل "15" أو "15 شيكل" أو "خمستعش". لا تحوّله ولا تحسبه؛ الخادم يقرؤه.',
    );

  return {
    ...read,
    ...catalogTools.mutate,
    ...partyTools.mutate,
    ...mediaTools.mutate,
    ...sellingUnitTools.mutate,
    prepareProductUpdate: tool({
      description:
        "جهّز بطاقة تأكيد لتعديل بيانات منتج (الاسم، الاسم اللاتيني، الوصف، القسم، الوحدة، سعر البيع، التوفر). SKU والباركود يتبعان الصنف: استعمل prepareVariantUpdate لهما، حتى لو كان للمنتج صنف واحد. لا ينفّذ شيئاً.",
      inputSchema: z
        .object({
          product,
          changes: z
            .object({
              nameAr: z.string().trim().max(160).optional(),
              latinName: z.string().trim().max(120).nullable().optional(),
              description: z.string().trim().max(4_000).optional(),
              categoryId: z
                .string()
                .trim()
                .max(80)
                .describe("اسم القسم الجديد أو رمزه")
                .optional(),
              unit: z.string().trim().max(80).optional(),
              priceIls: money.optional(),
              availability: z.enum(["available", "unavailable"]).optional(),
            })
            .strict(),
        })
        .strict(),
      execute: (input) =>
        prepare("prepareProductUpdate", input, () =>
          ops.prepareProductUpdate(actor, input),
        ),
    }),
    prepareProductImageReplacement: tool({
      description:
        "جهّز بطاقة استبدال صورة منتج موجود بصورة مرفقة (attachmentId)، مثل «حطي هاي الصورة لـ…». لا تبدأ مسودة لمنتج موجود.",
      inputSchema: z.object({ product, attachmentId: z.uuid() }).strict(),
      execute: (input) =>
        prepare("prepareProductImageReplacement", input, () =>
          ops.prepareProductImageReplacement(actor, input),
        ),
    }),
    prepareProductArchive: tool({
      description:
        "جهّز بطاقة أرشفة منتج فقط عندما تطلب المستخدمة «أرشفي» أو إيقاف المنتج نهائياً عن البيع: يخرج من الكتالوج ويبقى تاريخه ويمكن استرجاعه. «اخفي/أخفي عن المتجر» ليست أرشفة؛ استعمل prepareProductPublication بحالة مخفي. للحذف النهائي لمنتج غير مستخدم استعمل prepareUnusedProductDeletion.",
      inputSchema: z.object({ product, reason: text(200) }).strict(),
      execute: (input) =>
        prepare("prepareProductArchive", input, () =>
          ops.prepareProductArchive(actor, input),
        ),
    }),
    prepareProductMerge: tool({
      description:
        "جهّز بطاقة دمج منتج مكرر (duplicate) في المنتج الصحيح (target) مع نقل كميته.",
      inputSchema: z.object({ duplicate: product, target: product }).strict(),
      execute: (input) =>
        prepare("prepareProductMerge", input, () =>
          ops.prepareProductMerge(actor, input),
        ),
    }),
    prepareInventoryCorrection: tool({
      description:
        "جهّز بطاقة تعديل مخزون منتج («صار عندي 20»، «صلحي المخزون»). correction = الكمية الصحيحة بعد العد. damaged/expired = الكمية التي ستُخصم. هي طريقة تعديل المخزون من المساعد.",
      inputSchema: z
        .object({
          product,
          reason: z.enum(["correction", "damaged", "expired"]),
          quantity,
          note: z.string().trim().max(200).optional(),
        })
        .strict(),
      execute: (input) =>
        prepare("prepareInventoryCorrection", input, () =>
          ops.prepareInventoryCorrection(actor, input),
        ),
    }),
    prepareStockTransfer: tool({
      description:
        "جهّز بطاقة نقل كمية من صنف سُجّلت عليه بالخطأ إلى الصنف الصحيح.",
      inputSchema: z.object({ from: product, to: product, quantity }).strict(),
      execute: (input) =>
        prepare("prepareStockTransfer", input, () =>
          ops.prepareStockTransfer(actor, input),
        ),
    }),
    prepareReorderThreshold: tool({
      description: "جهّز بطاقة تغيير حد إعادة الطلب لصنف (null لإلغاء الحد).",
      inputSchema: z
        .object({ product, threshold: quantity.nullable() })
        .strict(),
      execute: (input) =>
        prepare("prepareReorderThreshold", input, () =>
          ops.prepareReorderThreshold(actor, input),
        ),
    }),
    prepareManualSale: tool({
      description:
        "جهّز بطاقة بيع مباشر. الأسعار تُؤخذ من النظام إلا إذا ذكرت المستخدمة سعراً مختلفاً. إذا ذكرت طريقة بيع (حبة، باكيج، كرتونة) مرّرها في sellingOption وتصبح quantity عدد الباكيجات. payment: full دفع كامل، partial جزء (paidIls)، none على الحساب.",
      inputSchema: z
        .object({
          customer: z.string().trim().max(100).nullable(),
          items: z
            .array(
              z
                .object({
                  product,
                  quantity,
                  unitPriceIls: money.optional(),
                  sellingOption: text(60)
                    .optional()
                    .describe(
                      "طريقة البيع كما قالتها المستخدمة، مثل «باكيج» أو «كرتونة 6»",
                    ),
                })
                .strict(),
            )
            .min(1)
            .max(20),
          payment: z.enum(["full", "partial", "none"]),
          paidIls: money.optional(),
        })
        .strict(),
      execute: (input) =>
        prepare("prepareManualSale", input, () =>
          ops.prepareManualSale(actor, input),
        ),
    }),
    prepareCustomerPayment: tool({
      description:
        "جهّز بطاقة تسجيل دفعة من زبون على دينه. إذا لم تذكر المستخدمة المبلغ، أو ذكرت أكثر من مبلغ، أو لم تكن متأكدة، استدعها بدون amountIls؛ الخادم يقرأ رسالتها ويعيد ما يجب السؤال عنه.",
      inputSchema: z
        .object({ customer: text(100), amountIls: money.optional() })
        .strict(),
      execute: (input) =>
        prepare("prepareCustomerPayment", input, async () =>
          input.amountIls
            ? ops.prepareCustomerPayment(actor, {
                ...input,
                amountIls: input.amountIls,
              })
            : missingAmountClarification(
                context,
                "اكتبي مبلغ الدفعة كما دفعته الزبونة.",
              ),
        ),
    }),
    prepareOrderCancellation: tool({
      description: "جهّز بطاقة إلغاء طلب برقمه وفق قواعد حالات الطلب.",
      inputSchema: z
        .object({ reference: text(30), reason: text(180) })
        .strict(),
      execute: (input) =>
        prepare("prepareOrderCancellation", input, () =>
          ops.prepareOrderCancellation(actor, input),
        ),
    }),
    preparePurchaseInvoiceImport: tool({
      description:
        "جهّز بطاقة قراءة فاتورة شراء من الصور المرفقة (attachmentIds) ثم مراجعتها.",
      inputSchema: z
        .object({ attachmentIds: z.array(z.uuid()).min(1).max(6) })
        .strict(),
      execute: (input) =>
        prepare("preparePurchaseInvoiceImport", input, () =>
          ops.preparePurchaseInvoiceImport(actor, input),
        ),
    }),
  };
}
