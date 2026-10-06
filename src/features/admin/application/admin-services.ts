import "server-only";
import { ProductOptionsService } from "./product-options-service";

import { ReminderService } from "@/features/reminders/application/reminder-service";
import { ScheduledJobs } from "@/features/reminders/application/scheduled-jobs";
import { SummaryService } from "@/features/reminders/application/summary-service";
import { ReportService } from "@/features/reports/application/report-service";
import { CustomerService } from "@/features/sales/application/customer-service";
import { SalesService } from "@/features/sales/application/sales-service";
import { getInsightGenerator } from "@/server/ai/insight-generator";
import { VoiceService } from "@/features/voice/application/voice-service";
import { getVoiceInterpreter } from "@/server/ai/voice-interpreter";
import { AssistantOperations } from "@/features/assistant/application/assistant-operations";
import { AttachmentService } from "@/features/assistant/application/attachment-service";
import { ConfirmationService } from "@/features/assistant/application/confirmation-service";
import { ConversationRepository } from "@/features/assistant/application/conversation-repository";
import { ToolRunLog } from "@/features/assistant/application/tool-run-log";
import { getInvoiceExtractor } from "@/server/ai/invoice-extractor";
import { db } from "@/server/db/db";
import { getProductImageStore } from "@/server/storage/product-images";
import { getPrivateDocumentStore } from "@/server/storage/private-documents";

import { AdminCatalogService } from "./admin-catalog-service";
import { AdminDashboardService } from "./admin-dashboard-service";
import { AdminSearchService } from "./admin-search-service";
import { AdminTodayService } from "./admin-today-service";
import { AdminDeliveryService } from "./admin-delivery-service";
import { AdminOrderService } from "./admin-order-service";
import { AdminNotificationService } from "../notifications/notification-service";
import { AdminStaffService } from "./admin-staff-service";
import { OfferService } from "@/features/offers/application/offer-service";
import { SupplierMaintenanceService } from "@/features/purchasing/application/supplier-maintenance-service";
import { CustomerMaintenanceService } from "@/features/sales/application/customer-maintenance-service";
import { QaStockSimulationService } from "@/features/admin/application/qa-stock-simulation";
import { CatalogAuthoringService } from "@/features/admin/application/catalog-authoring-service";
import { ProductMaintenanceService } from "./product-maintenance-service";
import { SellingUnitService } from "@/features/admin/application/selling-unit-service";
import { InventoryService } from "@/features/inventory/application/inventory-service";
import { PriceReviewService } from "@/features/inventory/application/price-review-service";
import { ExtractionService } from "@/features/purchasing/application/extraction-service";
import { PurchaseService } from "@/features/purchasing/application/purchase-service";
import { SupplierService } from "@/features/purchasing/application/supplier-service";

export const adminOrderService = new AdminOrderService(db);
export const adminCatalogService = new AdminCatalogService(db);
export const adminDeliveryService = new AdminDeliveryService(db);
export const adminDashboardService = new AdminDashboardService(db);
export const adminNotificationService = new AdminNotificationService(db);
export const adminStaffService = new AdminStaffService(db);
export const inventoryService = new InventoryService(db);
export const priceReviewService = new PriceReviewService(db);
export const purchaseService = new PurchaseService(db);
export const supplierService = new SupplierService(db);
export const salesService = new SalesService(db);
export const customerService = new CustomerService(db);
export const reportService = new ReportService(
  db,
  customerService,
  inventoryService,
);
export const adminSearchService = new AdminSearchService({
  orders: adminOrderService,
  inventory: inventoryService,
  customers: customerService,
  sales: salesService,
  suppliers: supplierService,
});
export const adminTodayService = new AdminTodayService({
  dashboard: adminDashboardService,
  orders: adminOrderService,
  sales: salesService,
  purchases: purchaseService,
  inventory: inventoryService,
  reports: reportService,
});
export const extractionService = new ExtractionService(
  db,
  purchaseService,
  getPrivateDocumentStore,
);
export const reminderService = new ReminderService(
  db,
  customerService,
  adminNotificationService,
);
export const summaryService = new SummaryService(
  db,
  reportService,
  adminNotificationService,
  getInsightGenerator,
);
export const scheduledJobs = new ScheduledJobs(
  db,
  reminderService,
  summaryService,
  async (now) => ({
    assistantAttachments: await assistantAttachments.expireTemporary(now),
    assistantConfirmations: await assistantConfirmations.expirePending(now),
    ...(await assistantConversations.purge(now)),
  }),
);
export const voiceService = new VoiceService(
  db,
  getVoiceInterpreter,
  inventoryService,
  salesService,
  customerService,
  supplierService,
  reportService,
);
export const productMaintenanceService = new ProductMaintenanceService(db);
export const catalogAuthoringService = new CatalogAuthoringService(db);
export const productOptionsService = new ProductOptionsService(
  db,
  catalogAuthoringService,
);
export const sellingUnitService = new SellingUnitService(db);
export const offerService = new OfferService(db);
export const customerMaintenanceService = new CustomerMaintenanceService(db);
export const supplierMaintenanceService = new SupplierMaintenanceService(db);
export const assistantAttachments = new AttachmentService(
  db,
  getPrivateDocumentStore,
);
export const assistantConversations = new ConversationRepository(db);
export const assistantToolRuns = new ToolRunLog(db);
export const assistantOperations = new AssistantOperations({
  database: db,
  catalog: adminCatalogService,
  authoring: catalogAuthoringService,
  maintenance: productMaintenanceService,
  sellingUnits: sellingUnitService,
  inventory: inventoryService,
  sales: salesService,
  customers: customerService,
  customerMaintenance: customerMaintenanceService,
  suppliers: supplierService,
  supplierMaintenance: supplierMaintenanceService,
  offers: offerService,
  orders: adminOrderService,
  extraction: extractionService,
  attachments: assistantAttachments,
  productImages: getProductImageStore,
  invoiceExtractor: getInvoiceExtractor,
});
export const assistantConfirmations = new ConfirmationService(
  db,
  assistantOperations,
  assistantConversations,
  assistantToolRuns,
);

// Off unless QA_STOCK_SIMULATION=on; owner-only even when on.
export const qaStockSimulation = new QaStockSimulationService(db, {
  enabled: () => process.env.QA_STOCK_SIMULATION === "on",
});
