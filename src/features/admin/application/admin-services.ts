import "server-only";

import { ReminderService } from "@/features/reminders/application/reminder-service";
import { ScheduledJobs } from "@/features/reminders/application/scheduled-jobs";
import { SummaryService } from "@/features/reminders/application/summary-service";
import { ReportService } from "@/features/reports/application/report-service";
import { CustomerService } from "@/features/sales/application/customer-service";
import { SalesService } from "@/features/sales/application/sales-service";
import { getInsightGenerator } from "@/server/ai/insight-generator";
import { db } from "@/server/db/db";
import { getPrivateDocumentStore } from "@/server/storage/private-documents";

import { AdminCatalogService } from "./admin-catalog-service";
import { AdminDashboardService } from "./admin-dashboard-service";
import { AdminDeliveryService } from "./admin-delivery-service";
import { AdminOrderService } from "./admin-order-service";
import { AdminNotificationService } from "../notifications/notification-service";
import { AdminStaffService } from "./admin-staff-service";
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
);
