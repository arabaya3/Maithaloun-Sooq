import "server-only";

import type { AdminOrderService } from "@/features/admin/application/admin-order-service";
import type { AdminActor } from "@/features/admin/domain/admin-actor";
import { can } from "@/features/admin/domain/permissions";
import type { InventoryService } from "@/features/inventory/application/inventory-service";
import { orderStatusLabels } from "@/features/orders/domain/order-status";
import type { SupplierService } from "@/features/purchasing/application/supplier-service";
import type { CustomerService } from "@/features/sales/application/customer-service";
import type { SalesService } from "@/features/sales/application/sales-service";
import { toLatinDigits } from "@/shared/lib/digits";
import { normalizeArabicText } from "@/shared/lib/normalize-arabic";

export const SEARCH_MIN_LENGTH = 2;
const PER_GROUP = 5;

export type SearchGroupKey =
  "products" | "variants" | "orders" | "customers" | "invoices" | "suppliers";

export interface SearchHit {
  id: string;
  label: string;
  detail: string | null;
  href: string;
}

export interface SearchGroup {
  key: SearchGroupKey;
  label: string;
  hits: SearchHit[];
}

const groupLabels: Record<SearchGroupKey, string> = {
  products: "المنتجات",
  variants: "الأصناف",
  orders: "الطلبات",
  customers: "الزبائن",
  invoices: "فواتير البيع",
  suppliers: "الموردون",
};

/** Same reading as the orders page: «MS-…» is a reference, digits or + a phone, anything else a name. */
function orderQuery(query: string) {
  if (query.startsWith("MS-")) return { publicReference: query };
  if (/[\d+]/.test(query)) return { phone: query };
  return { customerName: query };
}

export class AdminSearchService {
  constructor(
    private readonly services: {
      orders: AdminOrderService;
      inventory: InventoryService;
      customers: CustomerService;
      sales: SalesService;
      suppliers: SupplierService;
    },
  ) {}

  /** Every group runs only for actors allowed to see it, so results never reveal what a role cannot open. */
  async search(actor: AdminActor, raw: string): Promise<SearchGroup[]> {
    const query = toLatinDigits(raw.normalize("NFKC")).trim().slice(0, 80);
    if (query.length < SEARCH_MIN_LENGTH) return [];
    const needle = normalizeArabicText(query);
    const invoiceNumber = /^#?\d{1,9}$/.test(query)
      ? Number(query.replace("#", ""))
      : null;

    const [stock, orders, customers, invoices, suppliers] = await Promise.all([
      can(actor, "stock.view")
        ? this.services.inventory.listStock(actor, { search: query })
        : [],
      this.services.orders
        .list(actor, { ...orderQuery(query), page: 1 })
        .then((result) => result.items),
      can(actor, "customers.view")
        ? this.services.customers.findByName(actor, query)
        : [],
      can(actor, "sales.record") && invoiceNumber !== null
        ? this.services.sales.listInvoices(actor, PER_GROUP, { invoiceNumber })
        : [],
      can(actor, "suppliers.manage")
        ? this.services.suppliers
            .list(actor)
            .then((rows) =>
              rows.filter((row) =>
                normalizeArabicText(row.nameAr).includes(needle),
              ),
            )
        : [],
    ]);

    const products = new Map<string, SearchHit>();
    for (const item of stock) {
      if (products.size >= PER_GROUP) break;
      if (!products.has(item.productId)) {
        products.set(item.productId, {
          id: item.productId,
          label: item.name,
          detail: null,
          href: `/admin/products/${item.productId}`,
        });
      }
    }
    const groups: SearchGroup[] = [
      { key: "products", hits: [...products.values()] },
      {
        key: "variants",
        hits: stock
          .filter((item) => item.variantLabel)
          .slice(0, PER_GROUP)
          .map((item) => ({
            id: item.variantId,
            label: `${item.name} — ${item.variantLabel}`,
            detail: item.sku ?? item.barcode,
            href: `/admin/inventory/stock/${item.variantId}`,
          })),
      },
      {
        key: "orders",
        hits: orders.slice(0, PER_GROUP).map((order) => ({
          id: order.publicReference,
          label: `طلب ${order.publicReference.slice(-6)}`,
          detail: `${order.customerName} · ${orderStatusLabels[order.status]}`,
          href: `/admin/orders/${order.publicReference}`,
        })),
      },
      {
        key: "customers",
        hits: customers.slice(0, PER_GROUP).map((customer) => ({
          id: customer.id,
          label: customer.name,
          detail: null,
          href: `/admin/customers/${customer.id}`,
        })),
      },
      {
        key: "invoices",
        hits: invoices.map((invoice) => ({
          id: invoice.id,
          label: `فاتورة بيع ${invoice.invoiceNumber}`,
          detail: invoice.customerName ?? "بيع نقدي بدون اسم",
          href: `/admin/sales/${invoice.id}`,
        })),
      },
      {
        key: "suppliers",
        hits: suppliers.slice(0, PER_GROUP).map((supplier) => ({
          id: supplier.id,
          label: supplier.nameAr,
          detail: supplier.phone,
          href: `/admin/inventory/suppliers/${supplier.id}`,
        })),
      },
    ]
      .map((group) => ({
        ...group,
        key: group.key as SearchGroupKey,
        label: groupLabels[group.key as SearchGroupKey],
      }))
      .filter((group) => group.hits.length);
    return groups;
  }
}
