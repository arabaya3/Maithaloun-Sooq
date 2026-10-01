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
] as const;

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
] as const;
export type AssistantOperation = (typeof operations)[number];

export const prepareToolNames = [
  "prepareProductUpdate",
  "prepareProductImageReplacement",
  "prepareProductArchive",
  "prepareProductMerge",
  "prepareInventoryCorrection",
  "prepareStockTransfer",
  "prepareReorderThreshold",
  "prepareManualSale",
  "prepareCustomerPayment",
  "prepareOrderCancellation",
  "preparePurchaseInvoiceImport",
] as const;

export type RiskLevel = 1 | 2 | 3;

export const operationRisk: Record<AssistantOperation, 2 | 3> = {
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
};

export function toolRisk(toolName: string): RiskLevel {
  if ((readToolNames as readonly string[]).includes(toolName)) return 1;
  const operation = toolName.replace(/^prepare/, "");
  const key = (operation.charAt(0).toLowerCase() +
    operation.slice(1)) as AssistantOperation;
  return operationRisk[key] ?? 3;
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
export const MAX_AGENT_STEPS = 6;
export const MAX_USER_TEXT = 2_000;
export const MAX_HISTORY_MESSAGES = 24;
