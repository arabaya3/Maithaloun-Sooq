import type { Metadata } from "next";
import { connection } from "next/server";

import {
  customerService,
  inventoryService,
  sellingUnitService,
} from "@/features/admin/application/admin-services";
import { requireAdminSession } from "@/features/admin/auth/admin-session";
import { PageHeader } from "@/features/admin/ui/kit";
import { formatQuantity } from "@/features/inventory/domain/quantity";
import { emptySaleDraft } from "@/features/sales/domain/sale-draft";
import { SaleForm } from "@/features/sales/ui/sale-form";
import { formatIls } from "@/shared/lib/format-currency";

export const metadata: Metadata = { title: "بيع يدوي" };

export default async function ManualSalePage({
  searchParams,
}: {
  searchParams: Promise<{ customer?: string }>;
}) {
  await connection();
  const actor = await requireAdminSession();
  const [stock, customers, sellingUnits] = await Promise.all([
    inventoryService.listStock(actor),
    customerService.list(actor),
    sellingUnitService.activeByVariant(),
  ]);
  const requested = (await searchParams).customer;
  const preselected = customers.find((customer) => customer.id === requested);
  const draft = emptySaleDraft();
  if (preselected) {
    draft.customerMode = "existing";
    draft.customerId = preselected.id;
  }

  return (
    <main className="admin-page admin-page--narrow">
      <PageHeader
        title="بيع يدوي"
        lede="سجّلي ما بيع في المحل. يُخصم من المخزون بعد تأكيدك فقط."
        back={{ href: "/admin/sales", label: "المبيعات" }}
      />
      <SaleForm
        variants={stock.map((item) => ({
          variantId: item.variantId,
          name: item.name,
          variantLabel: item.variantLabel,
          sku: item.sku,
          barcode: item.barcode,
          priceAgorot: item.salePriceAgorot,
          sellingUnits: sellingUnits.get(item.variantId) ?? [],
          hint: `${formatIls(item.salePriceAgorot)} · ${
            item.tracked
              ? `المتوفر ${formatQuantity(item.availableMilli)}`
              : "بدون تتبّع مخزون"
          }`,
        }))}
        customers={customers}
        initialDraft={draft}
      />
    </main>
  );
}
