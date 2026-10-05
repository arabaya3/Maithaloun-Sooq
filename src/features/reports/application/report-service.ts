import "server-only";

import { sql } from "drizzle-orm";

import type { AdminActor } from "@/features/admin/domain/admin-actor";
import { assertPermission } from "@/features/admin/domain/permissions";
import type { InventoryService } from "@/features/inventory/application/inventory-service";
import type { Database } from "@/features/inventory/application/stock-ledger";
import { unitsToMilli } from "@/features/inventory/domain/quantity";
import type { StockUnit } from "@/features/inventory/domain/stock-constants";
import {
  buildReport,
  type ReportPeriod,
  type ReportResult,
  type SaleFact,
} from "@/features/reports/domain/report-calculation";
import type { CustomerService } from "@/features/sales/application/customer-service";
import { OVERDUE_AFTER_DAYS } from "@/features/sales/domain/customer-balance";
import { proportionAgorot } from "@/shared/lib/money-math";
import {
  addDays,
  daysBetween,
  startOfStoreDay,
  toStoreDate,
} from "@/shared/lib/store-time";

export const SLOW_MOVING_DAYS = 30;

export interface BusinessReport extends ReportResult {
  generatedAt: string;
  deliveryFeesAgorot: number;
  lowStock: Array<{ name: string; availableMilli: number; unit: StockUnit }>;
  outOfStock: Array<{ name: string }>;
  slowMoving: Array<{
    name: string;
    onHandMilli: number;
    unit: StockUnit;
    daysSinceSale: number | null;
  }>;
  overdueCustomers: Array<{
    id: string;
    name: string;
    balanceAgorot: number;
    ageDays: number;
  }>;
  costChanges: Array<{
    name: string;
    previousCostAgorot: number | null;
    newCostAgorot: number;
  }>;
}

export interface Debtor {
  id: string;
  name: string;
  balanceAgorot: number;
  oldestDays: number | null;
}

type Row = Record<string, unknown>;
const int = (value: unknown) => Number(value ?? 0);

// Spreads an invoice discount over its lines so the shares add up to the discount exactly.
function discountShares(lineTotals: number[], discount: number): number[] {
  const subtotal = lineTotals.reduce((total, value) => total + value, 0);
  if (discount === 0 || subtotal === 0) return lineTotals.map(() => 0);
  const shares = lineTotals.map((total) =>
    proportionAgorot(discount, total, subtotal),
  );
  const residue = discount - shares.reduce((total, value) => total + value, 0);
  const largest = lineTotals.indexOf(Math.max(...lineTotals));
  shares[largest] = shares[largest]! + residue;
  return shares;
}

function sellingFields(row: Row, saleQuantityMilli: number) {
  const key = String(row.product_key);
  return {
    productGroupKey: String(row.product_group),
    productName: String(row.product_name),
    sellingUnitKey: row.selling_unit_id
      ? `${key}::${String(row.selling_unit_id)}`
      : `${key}::base`,
    sellingUnitLabel: row.selling_unit_label_snapshot
      ? String(row.selling_unit_label_snapshot)
      : null,
    unitsPerSale: int(row.units_per_sale) || 1,
    saleQuantityMilli,
  };
}

export class ReportService {
  constructor(
    private readonly database: Database,
    private readonly customers: CustomerService,
    private readonly inventory: InventoryService,
  ) {}

  async getReport(
    actor: AdminActor,
    period: ReportPeriod,
  ): Promise<BusinessReport> {
    assertPermission(actor, "reports.view");
    const from = startOfStoreDay(period.from);
    const to = startOfStoreDay(addDays(period.to, 1));
    const fromIso = from.toISOString();
    const toIso = to.toISOString();

    const [orderRows, invoiceRows, totalsRow, stock, debtors, costRows] =
      await Promise.all([
        this.database.execute<Row>(sql`
          select o.id as document_id, h.created_at as sold_at,
            coalesce(oi.variant_domain_id, oi.product_domain_id) as product_key,
            oi.product_name_snapshot as name, oi.quantity,
            oi.units_per_sale, oi.selling_unit_id, oi.selling_unit_label_snapshot,
            oi.product_domain_id as product_group, p.name_ar as product_name,
            oi.line_subtotal_agorot as gross,
            (select -sum(m.value_delta_agorot)
               from stock_movements m
              where m.order_item_id = oi.id and m.reason = 'order_fulfillment') as cogs
          from order_status_history h
          join orders o on o.id = h.order_id
          join order_items oi on oi.order_id = o.id
          join products p on p.domain_id = oi.product_domain_id
          where h.new_status = 'delivered'
            and not o.is_test
            and h.created_at >= ${fromIso}::timestamptz and h.created_at < ${toIso}::timestamptz
        `),
        this.database.execute<Row>(sql`
          select i.id as document_id, i.created_at as sold_at, i.cancelled_at,
            i.discount_agorot as discount, l.line_no,
            v.domain_id as product_key, l.product_name_snapshot as name,
            l.quantity_milli, l.line_total_agorot as gross, l.cogs_agorot as cogs,
            l.units_per_sale, l.pack_quantity, l.selling_unit_id, l.selling_unit_label_snapshot,
            p.domain_id as product_group, p.name_ar as product_name
          from customer_invoices i
          join customer_invoice_lines l on l.invoice_id = i.id
          join product_variants v on v.id = l.variant_id
          join products p on p.id = v.product_id
          where (i.created_at >= ${fromIso}::timestamptz and i.created_at < ${toIso}::timestamptz)
             or (i.cancelled_at >= ${fromIso}::timestamptz and i.cancelled_at < ${toIso}::timestamptz)
          order by i.id, l.line_no
        `),
        this.database.execute<Row>(sql`
          select
            (select coalesce(sum(amount_agorot), 0) from customer_payments
              where created_at >= ${fromIso}::timestamptz and created_at < ${toIso}::timestamptz) as manual_cash,
            (select coalesce(sum(o.final_total_agorot), 0)
               from order_status_history h join orders o on o.id = h.order_id
              where h.new_status = 'delivered'
                and not o.is_test
                and h.created_at >= ${fromIso}::timestamptz and h.created_at < ${toIso}::timestamptz) as order_cash,
            (select coalesce(sum(o.delivery_fee_agorot), 0)
               from order_status_history h join orders o on o.id = h.order_id
              where h.new_status = 'delivered'
                and not o.is_test
                and h.created_at >= ${fromIso}::timestamptz and h.created_at < ${toIso}::timestamptz) as delivery_fees,
            (select coalesce(sum(total_agorot - paid_at_sale_agorot), 0)
               from customer_invoices
              where status = 'posted'
                and created_at >= ${fromIso}::timestamptz and created_at < ${toIso}::timestamptz) as credit_sales,
            (select coalesce(sum(total_agorot), 0) from purchase_invoices
              where invoice_date >= ${period.from} and invoice_date <= ${period.to}) as purchases,
            (select coalesce(sum(stock_value_agorot), 0) from inventory_items) as inventory_value,
            (select coalesce(-sum(value_delta_agorot), 0) from stock_movements
              where reason in ('damaged', 'expired', 'correction')
                and created_at >= ${fromIso}::timestamptz and created_at < ${toIso}::timestamptz) as shrinkage
        `),
        this.inventory.listStock(actor, { filter: "tracked" }),
        this.listDebtors(actor),
        this.database.execute<Row>(sql`
          select p.name_ar as name, r.previous_cost_agorot, r.new_cost_agorot
          from price_reviews r
          join product_variants v on v.id = r.variant_id
          join products p on p.id = v.product_id
          where r.created_at >= ${fromIso}::timestamptz and r.created_at < ${toIso}::timestamptz
            and r.previous_cost_agorot is not null
            and r.previous_cost_agorot <> r.new_cost_agorot
          order by r.created_at desc
          limit 10
        `),
      ]);

    const sales: SaleFact[] = [];
    const returns: SaleFact[] = [];
    for (const row of orderRows) {
      sales.push({
        channel: "storefront",
        documentId: String(row.document_id),
        date: toStoreDate(new Date(row.sold_at as string)),
        productKey: String(row.product_key),
        name: String(row.name),
        // Pieces, not packs: two 3-packs are six units out of stock.
        quantityMilli: unitsToMilli(
          int(row.quantity) * int(row.units_per_sale),
        ),
        ...sellingFields(row, unitsToMilli(int(row.quantity))),
        grossAgorot: int(row.gross),
        discountAgorot: 0,
        cogsAgorot: row.cogs === null ? null : int(row.cogs),
      });
    }

    const byInvoice = new Map<string, Row[]>();
    for (const row of invoiceRows) {
      const id = String(row.document_id);
      byInvoice.set(id, [...(byInvoice.get(id) ?? []), row]);
    }
    for (const [documentId, lines] of byInvoice) {
      const shares = discountShares(
        lines.map((line) => int(line.gross)),
        int(lines[0]!.discount),
      );
      const soldAt = new Date(lines[0]!.sold_at as string);
      const cancelledAt = lines[0]!.cancelled_at
        ? new Date(lines[0]!.cancelled_at as string)
        : null;
      const facts = lines.map((line, index): SaleFact => ({
        channel: "manual",
        documentId,
        date: toStoreDate(soldAt),
        productKey: String(line.product_key),
        name: String(line.name),
        quantityMilli: int(line.quantity_milli),
        ...sellingFields(
          line,
          line.pack_quantity === null
            ? int(line.quantity_milli)
            : unitsToMilli(int(line.pack_quantity)),
        ),
        grossAgorot: int(line.gross),
        discountAgorot: shares[index]!,
        cogsAgorot: line.cogs === null ? null : int(line.cogs),
      }));
      if (soldAt >= from && soldAt < to) sales.push(...facts);
      if (cancelledAt && cancelledAt >= from && cancelledAt < to) {
        const date = toStoreDate(cancelledAt);
        returns.push(...facts.map((fact) => ({ ...fact, date })));
      }
    }

    const totals = totalsRow[0] ?? {};
    const report = buildReport({
      period,
      sales,
      returns,
      totals: {
        cashCollectedAgorot: int(totals.manual_cash) + int(totals.order_cash),
        creditSalesAgorot: int(totals.credit_sales),
        outstandingBalancesAgorot: debtors.reduce(
          (total, debtor) => total + debtor.balanceAgorot,
          0,
        ),
        purchasesAgorot: int(totals.purchases),
        inventoryValueAgorot: int(totals.inventory_value),
        shrinkageAgorot: int(totals.shrinkage),
      },
    });

    const lastSales = await this.lastSaleDates();
    const slowCutoff = addDays(period.to, -SLOW_MOVING_DAYS);
    return {
      ...report,
      generatedAt: new Date().toISOString(),
      deliveryFeesAgorot: int(totals.delivery_fees),
      lowStock: stock
        .filter((item) => item.status === "low")
        .map((item) => ({
          name: item.name,
          availableMilli: item.availableMilli,
          unit: item.unit,
        })),
      outOfStock: stock
        .filter((item) => item.status === "out")
        .map((item) => ({ name: item.name })),
      slowMoving: stock
        .filter((item) => item.onHandMilli > 0)
        .map((item) => ({ item, last: lastSales.get(item.variantId) ?? null }))
        .filter(({ last }) => last === null || last < slowCutoff)
        .map(({ item, last }) => ({
          name: item.name,
          onHandMilli: item.onHandMilli,
          unit: item.unit,
          daysSinceSale: last ? daysBetween(last, period.to) : null,
        }))
        .slice(0, 10),
      overdueCustomers: debtors
        .filter(
          (debtor) =>
            debtor.oldestDays !== null &&
            debtor.oldestDays > OVERDUE_AFTER_DAYS,
        )
        .map((debtor) => ({
          id: debtor.id,
          name: debtor.name,
          balanceAgorot: debtor.balanceAgorot,
          ageDays: debtor.oldestDays!,
        })),
      costChanges: [...costRows].map((row) => ({
        name: String(row.name),
        previousCostAgorot:
          row.previous_cost_agorot === null
            ? null
            : int(row.previous_cost_agorot),
        newCostAgorot: int(row.new_cost_agorot),
      })),
    };
  }

  // Operators may ask who owes money; amounts come straight from the ledger.
  async listDebtors(actor: AdminActor): Promise<Debtor[]> {
    assertPermission(actor, "customers.view");
    const owing = await this.customers.list(actor, { onlyOwing: true });
    const details = await Promise.all(
      owing.map((customer) => this.customers.getDetail(actor, customer.id)),
    );
    return owing.map((customer, index) => ({
      id: customer.id,
      name: customer.name,
      balanceAgorot: customer.balanceAgorot,
      oldestDays: details[index]?.summary.oldestUnpaid?.ageDays ?? null,
    }));
  }

  private async lastSaleDates(): Promise<Map<string, string>> {
    const rows = await this.database.execute<Row>(sql`
      select v.domain_id as variant_id, max(m.created_at) as last_sale
      from stock_movements m
      join inventory_items i on i.id = m.inventory_item_id
      join product_variants v on v.id = i.variant_id
      where m.reason in ('manual_sale', 'order_fulfillment')
      group by v.domain_id
    `);
    return new Map(
      [...rows].map((row) => [
        String(row.variant_id),
        toStoreDate(new Date(row.last_sale as string)),
      ]),
    );
  }
}
