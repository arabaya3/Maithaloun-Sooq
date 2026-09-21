import "server-only";

import { db } from "@/server/db/db";

import { AdminCatalogService } from "./admin-catalog-service";
import { AdminDashboardService } from "./admin-dashboard-service";
import { AdminDeliveryService } from "./admin-delivery-service";
import { AdminOrderService } from "./admin-order-service";

export const adminOrderService = new AdminOrderService(db);
export const adminCatalogService = new AdminCatalogService(db);
export const adminDeliveryService = new AdminDeliveryService(db);
export const adminDashboardService = new AdminDashboardService(db);
