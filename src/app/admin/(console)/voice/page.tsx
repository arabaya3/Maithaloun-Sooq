import type { Metadata } from "next";
import { connection } from "next/server";

import {
  customerService,
  inventoryService,
  sellingUnitService,
  supplierService,
} from "@/features/admin/application/admin-services";
import { requireAdminSession } from "@/features/admin/auth/admin-session";
import { PageHeader } from "@/features/admin/ui/kit";
import { formatQuantity } from "@/features/inventory/domain/quantity";
import { VoiceAssistant } from "@/features/voice/ui/voice-assistant";
import { formatIls } from "@/shared/lib/format-currency";

export const metadata: Metadata = { title: "سجّل عملية بالصوت" };

export default async function VoicePage() {
  await connection();
  const actor = await requireAdminSession();
  const [stock, customers, suppliers, sellingUnits] = await Promise.all([
    inventoryService.listStock(actor),
    customerService.list(actor),
    supplierService.list(actor),
    sellingUnitService.activeByVariant(),
  ]);
  const base = stock.map((item) => ({
    variantId: item.variantId,
    name: item.name,
    variantLabel: item.variantLabel,
    sku: item.sku,
    barcode: item.barcode,
    unit: item.unit,
    priceAgorot: item.salePriceAgorot,
    hint: `${formatIls(item.salePriceAgorot)} · ${
      item.tracked
        ? `المتوفر ${formatQuantity(item.availableMilli)}`
        : "بدون تتبّع مخزون"
    }`,
  }));

  return (
    <main className="admin-page admin-page--narrow">
      <PageHeader
        title="سجّل عملية بالصوت"
        lede="قولي ما حدث. أعرض عليك البطاقة للمراجعة، ولا يُحفظ شيء قبل تأكيدك."
      />
      <VoiceAssistant
        saleVariants={base.map((item) => ({
          ...item,
          sellingUnits: sellingUnits.get(item.variantId) ?? [],
        }))}
        purchaseVariants={base}
        customers={customers}
        suppliers={suppliers
          .filter((supplier) => supplier.active)
          .map((supplier) => ({ id: supplier.id, nameAr: supplier.nameAr }))}
      />
    </main>
  );
}
