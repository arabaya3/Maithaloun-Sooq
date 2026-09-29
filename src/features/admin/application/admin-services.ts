import "server-only";

import { db } from "@/server/db/db";

import { AdminCatalogService } from "./admin-catalog-service";
import { AdminDashboardService } from "./admin-dashboard-service";
import { AdminDeliveryService } from "./admin-delivery-service";
import { AdminOrderService } from "./admin-order-service";
import { AdminNotificationService } from "../notifications/notification-service";
import { AdminStaffService } from "./admin-staff-service";

export const adminOrderService = new AdminOrderService(db);
export const adminCatalogService = new AdminCatalogService(db);
export const adminDeliveryService = new AdminDeliveryService(db);
export const adminDashboardService = new AdminDashboardService(db);
export const adminNotificationService = new AdminNotificationService(db);
export const adminStaffService = new AdminStaffService(db);
