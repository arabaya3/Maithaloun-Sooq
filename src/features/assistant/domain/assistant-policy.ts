import type { AdminActor } from "@/features/admin/domain/admin-actor";

export const readToolNames = [
  "searchProducts",
  "getProductDetails",
  "getInventoryItem",
  "getInventorySummary",
  "getLowStockItems",
  "searchOrders",
  "getOrderDetails",
  "searchCustomers",
  "getCustomerBalance",
  "getDebtors",
  "getPurchaseInvoice",
  "getSalesSummary",
  "getProfitSummary",
  "analyzeProductImages",
  "searchProductDuplicates",
  "listCategories",
  "checkProductPublication",
] as const;

export const catalogOperations = [
  "productCreate",
  "productCreateWithStock",
  "productDetails",
  "productPublication",
  "productRestore",
  "productImageRemoval",
  "productDelete",
  "variantCreate",
  "variantUpdate",
  "variantDefault",
  "variantImage",
  "variantArchive",
  "variantRestore",
  "variantDelete",
  "specificationUpsert",
  "specificationRemove",
  "categoryCreate",
  "categoryUpdate",
  "categoryArchive",
  "categoryRestore",
  "categoryMerge",
  "categoryMove",
  "categoryDelete",
] as const;
export type CatalogOperation = (typeof catalogOperations)[number];

export const operations = [
  "productUpdate",
  "productImageReplacement",
  "productArchive",
  "productMerge",
  "inventoryCorrection",
  "stockTransfer",
  "reorderThreshold",
  "manualSale",
  "customerPayment",
  "orderCancellation",
  "purchaseInvoiceImport",
  ...catalogOperations,
] as const;
export type AssistantOperation = (typeof operations)[number];

export type RiskLevel = 1 | 2 | 3 | 4;

// 2: reversible content/configuration. 3: financial, stock or wide-reaching. 4: permanent deletion or access control.
export const operationRisk: Record<AssistantOperation, 2 | 3 | 4> = {
  productUpdate: 2,
  productImageReplacement: 2,
  reorderThreshold: 2,
  productArchive: 3,
  productMerge: 3,
  inventoryCorrection: 3,
  stockTransfer: 3,
  manualSale: 3,
  customerPayment: 3,
  orderCancellation: 3,
  purchaseInvoiceImport: 2,
  productCreate: 2,
  productCreateWithStock: 3,
  productDetails: 2,
  productPublication: 2,
  productRestore: 2,
  productImageRemoval: 2,
  productDelete: 4,
  variantCreate: 2,
  variantUpdate: 2,
  variantDefault: 2,
  variantImage: 2,
  variantArchive: 2,
  variantRestore: 2,
  variantDelete: 4,
  specificationUpsert: 2,
  specificationRemove: 2,
  categoryCreate: 2,
  categoryUpdate: 2,
  categoryArchive: 2,
  categoryRestore: 2,
  categoryMerge: 3,
  categoryMove: 2,
  categoryDelete: 4,
};

// Each prepare tool and the highest risk of the operations it can produce.
export const prepareToolRisk = {
  prepareProductUpdate: 2,
  prepareProductImageReplacement: 2,
  prepareProductArchive: 3,
  prepareProductMerge: 3,
  prepareInventoryCorrection: 3,
  prepareStockTransfer: 3,
  prepareReorderThreshold: 2,
  prepareManualSale: 3,
  prepareCustomerPayment: 3,
  prepareOrderCancellation: 3,
  preparePurchaseInvoiceImport: 2,
  prepareProductCreation: 2,
  prepareProductCreationWithOpeningStock: 3,
  prepareProductDetailsUpdate: 2,
  prepareProductPublication: 2,
  prepareProductRestore: 2,
  prepareProductImageRemoval: 2,
  prepareUnusedProductDeletion: 4,
  prepareVariantCreation: 2,
  prepareVariantUpdate: 2,
  prepareDefaultVariant: 2,
  prepareVariantImage: 2,
  prepareVariantArchive: 2,
  prepareUnusedVariantDeletion: 4,
  prepareProductSpecification: 2,
  prepareCategoryCreation: 2,
  prepareCategoryUpdate: 2,
  prepareCategoryArchive: 2,
  prepareCategoryMerge: 3,
  prepareProductsCategoryMove: 2,
  prepareEmptyCategoryDeletion: 4,
} as const satisfies Record<string, 2 | 3 | 4>;

export const prepareToolNames = Object.keys(prepareToolRisk) as Array<
  keyof typeof prepareToolRisk
>;

export function toolRisk(toolName: string): RiskLevel {
  if ((readToolNames as readonly string[]).includes(toolName)) return 1;
  if (toolName in prepareToolRisk) {
    return prepareToolRisk[toolName as keyof typeof prepareToolRisk];
  }
  const operation = toolName.replace(/^confirm/, "");
  const key = (operation.charAt(0).toLowerCase() +
    operation.slice(1)) as AssistantOperation;
  return operationRisk[key] ?? 4;
}

export const assistantModes = ["off", "read", "full"] as const;
export type AssistantMode = (typeof assistantModes)[number];

export function assistantMode(value: string | undefined): AssistantMode {
  return (assistantModes as readonly string[]).includes(value ?? "")
    ? (value as AssistantMode)
    : "off";
}

// The assistant is an owner tool; operators keep their existing screens.
export function canUseAssistant(actor: AdminActor, mode: AssistantMode) {
  return mode !== "off" && actor.active && actor.role === "owner";
}

export const CONFIRMATION_TTL_MS = 10 * 60 * 1_000;
export const ATTACHMENT_TTL_MS = 24 * 60 * 60 * 1_000;
export const CONVERSATION_RETENTION_DAYS = 90;
export const TOOL_RUN_RETENTION_DAYS = 365;
export const MAX_AGENT_STEPS = 8;
export const DESTRUCTIVE_TOKEN_TTL_MS = 2 * 60 * 1_000;
export const MAX_USER_TEXT = 2_000;
export const MAX_HISTORY_MESSAGES = 24;
