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
  "searchProductDuplicates",
  "listCategories",
  "checkProductPublication",
  "searchOffers",
  "getOfferDetails",
  "getCustomerDetails",
  "getCustomerStatement",
  "searchSuppliers",
  "getSupplierDetails",
  "getSupplierStatement",
  "getProductGallery",
  "getProductImageMapping",
  "getProductOptions",
  "getVariantMatrix",
  "getSellingUnits",
  "getVariantsWithoutSellingUnits",
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

export const partyOperations = [
  "offerCreate",
  "offerUpdate",
  "offerArchive",
  "offerRestore",
  "offerDelete",
  "customerCreate",
  "customerUpdate",
  "customerArchive",
  "customerRestore",
  "customerMerge",
  "customerDelete",
  "customerPaymentReversal",
  "customerBalanceAdjustment",
  "reminderSchedule",
  "supplierCreate",
  "supplierUpdate",
  "supplierArchive",
  "supplierRestore",
  "supplierMerge",
  "supplierDelete",
  "supplierPayment",
  "supplierCorrection",
  "supplierAlias",
] as const;
export type PartyOperation = (typeof partyOperations)[number];

export const mediaOperations = [
  "galleryAdd",
  "galleryReorder",
  "galleryPrimary",
  "galleryAlt",
  "galleryAssign",
  "galleryScope",
  "valueSharedImage",
  "galleryArchive",
  "galleryRestore",
  "galleryDelete",
  "optionCreate",
  "optionUpdate",
  "optionReorder",
  "optionArchive",
  "optionRestore",
  "optionDelete",
  "valueAdd",
  "valueUpdate",
  "valueReorder",
  "valueArchive",
  "valueRestore",
  "valueDelete",
  "variantsGenerate",
  "variantOptions",
  "productSetCreate",
] as const;
export type MediaOperation = (typeof mediaOperations)[number];

// Ways to buy one exact variant (a piece, a pack); stock always stays in base pieces.
export const sellingUnitOperations = [
  "sellingUnitsCreate",
  "sellingUnitUpdate",
  "sellingUnitDefault",
  "sellingUnitArchive",
  "sellingUnitRestore",
  "sellingUnitDelete",
] as const;
export type SellingUnitOperation = (typeof sellingUnitOperations)[number];

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
  "orderAdvance",
  "categoryReorder",
  "saleInvoiceCancellation",
  "purchaseInvoiceImport",
  ...catalogOperations,
  ...partyOperations,
  ...mediaOperations,
  ...sellingUnitOperations,
] as const;
export type AssistantOperation = (typeof operations)[number];

export type RiskLevel = 1 | 2 | 3 | 4;

// 2: reversible content/configuration. 3: financial, stock or wide-reaching. 4: permanent deletion or access control.
export const operationRisk: Record<AssistantOperation, 2 | 3 | 4> = {
  galleryAdd: 2,
  galleryReorder: 2,
  galleryPrimary: 2,
  galleryAlt: 2,
  galleryAssign: 2,
  galleryScope: 2,
  valueSharedImage: 2,
  galleryArchive: 2,
  galleryRestore: 2,
  galleryDelete: 4,
  optionCreate: 2,
  optionUpdate: 2,
  optionReorder: 2,
  optionArchive: 2,
  optionRestore: 2,
  optionDelete: 4,
  valueAdd: 2,
  valueUpdate: 2,
  valueReorder: 2,
  valueArchive: 2,
  valueRestore: 2,
  valueDelete: 4,
  variantsGenerate: 2,
  variantOptions: 2,
  productSetCreate: 3,
  sellingUnitsCreate: 2,
  sellingUnitUpdate: 2,
  sellingUnitDefault: 2,
  sellingUnitArchive: 2,
  sellingUnitRestore: 2,
  sellingUnitDelete: 4,
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
  orderAdvance: 3,
  categoryReorder: 2,
  saleInvoiceCancellation: 3,
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
  offerCreate: 2,
  offerUpdate: 2,
  offerArchive: 2,
  offerRestore: 2,
  offerDelete: 4,
  customerCreate: 2,
  customerUpdate: 2,
  customerArchive: 2,
  customerRestore: 2,
  customerMerge: 3,
  customerDelete: 4,
  customerPaymentReversal: 3,
  customerBalanceAdjustment: 3,
  reminderSchedule: 2,
  supplierCreate: 2,
  supplierUpdate: 2,
  supplierArchive: 2,
  supplierRestore: 2,
  supplierMerge: 3,
  supplierDelete: 4,
  supplierPayment: 3,
  supplierCorrection: 3,
  supplierAlias: 2,
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
  prepareOrderAdvance: 3,
  prepareCategoryReorder: 2,
  prepareSaleInvoiceCancellation: 3,
  preparePurchaseInvoiceImport: 2,
  prepareProductFromDraft: 3,
  prepareGalleryImagesAdd: 2,
  prepareGalleryReorder: 2,
  prepareGalleryImageChange: 2,
  prepareGalleryImageDeletion: 4,
  prepareImageMapping: 2,
  prepareSharedImageUse: 2,
  prepareProductOptionCreate: 2,
  prepareProductOptionChange: 2,
  prepareProductOptionDeletion: 4,
  prepareOptionValueChange: 2,
  prepareOptionValueDeletion: 4,
  prepareVariantGeneration: 2,
  prepareVariantChoices: 2,
  prepareSellingUnitsCreation: 2,
  prepareSellingUnitChange: 2,
  prepareSellingUnitDeletion: 4,
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
  prepareOfferCreation: 2,
  prepareOfferUpdate: 2,
  prepareOfferArchive: 2,
  prepareUnusedOfferDeletion: 4,
  prepareCustomerCreation: 2,
  prepareCustomerUpdate: 2,
  prepareCustomerArchive: 2,
  prepareUnusedCustomerDeletion: 4,
  prepareCustomerMerge: 3,
  prepareCustomerPaymentReversal: 3,
  prepareCustomerBalanceAdjustment: 3,
  prepareCustomerReminder: 2,
  prepareSupplierCreation: 2,
  prepareSupplierUpdate: 2,
  prepareSupplierArchive: 2,
  prepareUnusedSupplierDeletion: 4,
  prepareSupplierMerge: 3,
  prepareSupplierPayment: 3,
  prepareSupplierCorrection: 3,
  prepareSupplierProductAlias: 2,
} as const satisfies Record<string, 2 | 3 | 4>;

export const prepareToolNames = Object.keys(prepareToolRisk) as Array<
  keyof typeof prepareToolRisk
>;

// Draft tools only edit the owner's server-side draft; nothing in the store changes until a card is confirmed.
export const draftToolNames = [
  "startProductDraft",
  "updateProductDraft",
  "getProductDraft",
  "cancelProductDraft",
  "setDraftOptions",
  "setDraftVariants",
  "assignDraftImages",
] as const;

export function toolRisk(toolName: string): RiskLevel {
  if ((readToolNames as readonly string[]).includes(toolName)) return 1;
  if ((draftToolNames as readonly string[]).includes(toolName)) return 1;
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
