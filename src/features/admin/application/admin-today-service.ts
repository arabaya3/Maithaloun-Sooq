import "server-only";

import type { AdminDashboardService } from "@/features/admin/application/admin-dashboard-service";
import type { AdminOrderService } from "@/features/admin/application/admin-order-service";
import type { AdminActor } from "@/features/admin/domain/admin-actor";
import { can } from "@/features/admin/domain/permissions";
import type { InventoryService } from "@/features/inventory/application/inventory-service";
import { orderStatusLabels } from "@/features/orders/domain/order-status";
import type { OrderStatus } from "@/features/orders/domain/order-status";
import type { PurchaseService } from "@/features/purchasing/application/purchase-service";
import { paymentStatusLabels } from "@/features/purchasing/domain/purchase-constants";
import type { ReportService } from "@/features/reports/application/report-service";
import type { SalesService } from "@/features/sales/application/sales-service";
import {
  addDays,
  startOfStoreDay,
  todayInStoreZone,
} from "@/shared/lib/store-time";

/** A pending order waiting longer than this is raised as an alert. */
export const PENDING_ALERT_MINUTES = 30;
const TIMELINE_LIMIT = 12;

export type TodayTone = "success" | "warning" | "danger" | "neutral";

export interface TodayTask {
  id: string;
  kind: "order" | "sale" | "purchase";
  at: string;
  title: string;
  detail: string;
  href: string;
  badge: { label: string; tone: TodayTone };
}

export interface TodayAlert {
  id: "pending_overdue" | "low_stock" | "out_of_stock" | "out_for_delivery";
  count: number;
  href: string;
  tone: TodayTone;
}

export type TodayMoney = {
  netSalesAgorot: number;
  grossProfitAgorot: number;
  costComplete: boolean;
} | null;

export type TodayWeek = {
  days: Array<{ date: string; netSalesAgorot: number }>;
  totalAgorot: number;
  todayAgorot: number;
  yesterdayAgorot: number;
  top: Array<{ name: string; quantityMilli: number; netSalesAgorot: number }>;
} | null;

export interface TodayView {
  date: string;
  ordersToday: number;
  needsAction: number;
  tasks: TodayTask[];
  alerts: TodayAlert[];
  actionableOrders: Awaited<
    ReturnType<AdminDashboardService["getSummary"]>
  >["actionableOrders"];
}

const orderTone: Record<OrderStatus, TodayTone> = {
  pending: "warning",
  awaiting_whatsapp: "warning",
  confirmed: "neutral",
  preparing: "neutral",
  out_for_delivery: "neutral",
  delivered: "success",
  cancelled: "danger",
};

export class AdminTodayService {
  constructor(
    private readonly services: {
      dashboard: AdminDashboardService;
      orders: AdminOrderService;
      sales: SalesService;
      purchases: PurchaseService;
      inventory: InventoryService;
      reports: ReportService;
    },
  ) {}

  /** The fast part of the page: counts, what needs action, the day's feed and order alerts. */
  async getToday(actor: AdminActor, now = new Date()): Promise<TodayView> {
    const date = todayInStoreZone(now);
    const since = startOfStoreDay(date);
    const overdueBefore = new Date(
      now.getTime() - PENDING_ALERT_MINUTES * 60_000,
    );
    // The summary checks the operations role first; nothing else runs for anyone else.
    const summary = await this.services.dashboard.getSummary(actor);
    const [ordersToday, overdue, sales, purchases] = await Promise.all([
      this.services.orders.list(actor, { createdFrom: since, page: 1 }),
      this.services.orders.list(actor, {
        status: "pending",
        createdTo: overdueBefore,
        page: 1,
      }),
      can(actor, "sales.record")
        ? this.services.sales.listInvoices(actor, 50, { since })
        : [],
      can(actor, "purchase.record")
        ? this.services.purchases.list(actor, 50)
        : [],
    ]);

    const tasks: TodayTask[] = [
      ...ordersToday.items.map((order) => ({
        id: `order:${order.publicReference}`,
        kind: "order" as const,
        at: order.createdAt,
        title: `طلب ${order.publicReference.slice(-6)}`,
        detail: order.customerName,
        href: `/admin/orders/${order.publicReference}`,
        badge: {
          label: orderStatusLabels[order.status],
          tone: orderTone[order.status],
        },
      })),
      ...sales.map((invoice) => ({
        id: `sale:${invoice.id}`,
        kind: "sale" as const,
        at: invoice.createdAt,
        title: `فاتورة بيع ${invoice.invoiceNumber}`,
        detail: invoice.customerName ?? "بيع نقدي بدون اسم",
        href: `/admin/sales/${invoice.id}`,
        badge:
          invoice.status === "cancelled"
            ? { label: "ملغاة", tone: "danger" as const }
            : { label: "بيع مباشر", tone: "success" as const },
      })),
      ...purchases
        .filter((purchase) => new Date(purchase.createdAt) >= since)
        .map((purchase) => ({
          id: `purchase:${purchase.id}`,
          kind: "purchase" as const,
          at: purchase.createdAt,
          title: "فاتورة شراء",
          detail: purchase.supplierName,
          href: `/admin/inventory/purchases/${purchase.id}`,
          badge: {
            label: paymentStatusLabels[purchase.paymentStatus],
            tone:
              purchase.paymentStatus === "paid"
                ? ("success" as const)
                : ("warning" as const),
          },
        })),
    ]
      .sort((left, right) => right.at.localeCompare(left.at))
      .slice(0, TIMELINE_LIMIT);

    const alerts: TodayAlert[] = [
      {
        id: "pending_overdue" as const,
        count: overdue.total,
        href: "/admin/orders?status=pending&sort=oldest",
        tone: "danger" as const,
      },
      {
        id: "out_for_delivery" as const,
        count: summary.orders.out_for_delivery,
        href: "/admin/orders?status=out_for_delivery",
        tone: "neutral" as const,
      },
    ].filter((alert) => alert.count > 0);

    return {
      date,
      ordersToday: ordersToday.total,
      needsAction:
        summary.orders.pending +
        summary.orders.confirmed +
        summary.orders.preparing,
      tasks,
      alerts,
      actionableOrders: summary.actionableOrders,
    };
  }

  /** Owner only, streamed after the page: the same report the reports page uses, for today. */
  async getMoney(actor: AdminActor, now = new Date()): Promise<TodayMoney> {
    if (!can(actor, "reports.view")) return null;
    const date = todayInStoreZone(now);
    const report = await this.services.reports.getReport(actor, {
      from: date,
      to: date,
    });
    return {
      netSalesAgorot: report.metrics.netSalesAgorot,
      grossProfitAgorot: report.metrics.grossProfitAgorot,
      costComplete: report.metrics.costComplete,
    };
  }

  /** The last seven store days: daily net sales and the best-selling products, from one report. */
  async getWeek(actor: AdminActor, now = new Date()): Promise<TodayWeek> {
    if (!can(actor, "reports.view")) return null;
    const today = todayInStoreZone(now);
    const report = await this.services.reports.getReport(actor, {
      from: addDays(today, -6),
      to: today,
    });
    const days = report.profitSeries.map((point) => ({
      date: point.from,
      netSalesAgorot: point.netSalesAgorot,
    }));
    return {
      days,
      totalAgorot: report.metrics.netSalesAgorot,
      todayAgorot: days.at(-1)?.netSalesAgorot ?? 0,
      yesterdayAgorot: days.at(-2)?.netSalesAgorot ?? 0,
      top: report.byProduct.slice(0, 5).map((item) => ({
        name: item.name,
        quantityMilli: item.quantityMilli,
        netSalesAgorot: item.netSalesAgorot,
      })),
    };
  }

  /** Streamed after the page: stock alerts read every tracked variant. */
  async getStockAlerts(actor: AdminActor): Promise<TodayAlert[]> {
    if (!can(actor, "stock.view")) return [];
    const stock = await this.services.inventory.getOverview(actor);
    return [
      {
        id: "out_of_stock" as const,
        count: stock.outCount,
        href: "/admin/inventory/stock?filter=out",
        tone: "danger" as const,
      },
      {
        id: "low_stock" as const,
        count: stock.lowCount,
        href: "/admin/inventory/stock?filter=low",
        tone: "warning" as const,
      },
    ].filter((alert) => alert.count > 0);
  }
}
