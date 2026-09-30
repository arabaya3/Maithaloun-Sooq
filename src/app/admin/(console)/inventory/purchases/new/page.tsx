import type { Metadata } from "next";
import { connection } from "next/server";

import {
  inventoryService,
  supplierService,
} from "@/features/admin/application/admin-services";
import { requireAdminSession } from "@/features/admin/auth/admin-session";
import { PageHeader } from "@/features/admin/ui/kit";
import { formatQuantity } from "@/features/inventory/domain/quantity";
import {
  emptyPurchaseLine,
  type PurchaseDraft,
} from "@/features/purchasing/domain/purchase-draft";
import { PurchaseForm } from "@/features/purchasing/ui/purchase-form";
import { formatIls } from "@/shared/lib/format-currency";
import { todayInStoreZone } from "@/shared/lib/store-time";

export const metadata: Metadata = { title: "إدخال شراء يدوي" };

export default async function ManualPurchasePage() {
  await connection();
  const actor = await requireAdminSession();
  const [stock, suppliers] = await Promise.all([
    inventoryService.listStock(actor),
    supplierService.list(actor),
  ]);

  const initialDraft: PurchaseDraft = {
    supplierId: "",
    newSupplierName: "",
    reference: "",
    invoiceDate: todayInStoreZone(),
    lines: [emptyPurchaseLine()],
    discount: "",
    tax: "",
    printedTotal: "",
    payment: "paid",
    paid: "",
    notes: "",
  };

  return (
    <main className="admin-page admin-page--narrow">
      <PageHeader
        title="إدخال شراء يدوي"
        lede="أدخلي فاتورة المورد. لن يتغيّر المخزون قبل المراجعة والتأكيد."
        back={{ href: "/admin/inventory", label: "المخزون والمشتريات" }}
      />
      <PurchaseForm
        variants={stock.map((item) => ({
          variantId: item.variantId,
          name: item.name,
          variantLabel: item.variantLabel,
          sku: item.sku,
          barcode: item.barcode,
          unit: item.unit,
          hint: `${item.tracked ? `المتوفر ${formatQuantity(item.availableMilli)}` : "غير متتبَّع بعد"} · البيع ${formatIls(item.salePriceAgorot)}`,
        }))}
        suppliers={suppliers
          .filter((supplier) => supplier.active)
          .map((supplier) => ({ id: supplier.id, nameAr: supplier.nameAr }))}
        initialDraft={initialDraft}
      />
    </main>
  );
}
