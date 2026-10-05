import { formatQuantity } from "@/features/inventory/domain/quantity";
import { formatIls } from "@/shared/lib/format-currency";

export interface ShareableInvoice {
  invoiceNumber: number;
  customerName: string | null;
  date: string;
  lines: ReadonlyArray<{
    name: string;
    quantityMilli: number;
    // Set when sold by a selling unit, so the customer reads «باكيج 3 حبات × 2», not six pieces.
    sellingUnitLabel?: string | null;
    packQuantity?: number | null;
    lineTotalAgorot: number;
  }>;
  discountAgorot: number;
  totalAgorot: number;
  paidAtSaleAgorot: number;
}

export function buildInvoiceShareText(invoice: ShareableInvoice): string {
  const remaining = invoice.totalAgorot - invoice.paidAtSaleAgorot;
  return [
    `سوق ميثلون — فاتورة رقم ${invoice.invoiceNumber}`,
    invoice.customerName ? `الزبون: ${invoice.customerName}` : null,
    `التاريخ: ${invoice.date}`,
    "",
    ...invoice.lines.map((line) =>
      line.sellingUnitLabel && line.packQuantity
        ? `• ${line.name} — ${line.sellingUnitLabel} × ${line.packQuantity} = ${formatIls(line.lineTotalAgorot)}`
        : `• ${line.name} × ${formatQuantity(line.quantityMilli)} = ${formatIls(line.lineTotalAgorot)}`,
    ),
    "",
    invoice.discountAgorot > 0
      ? `الخصم: ${formatIls(invoice.discountAgorot)}`
      : null,
    `الإجمالي: ${formatIls(invoice.totalAgorot)}`,
    `المدفوع: ${formatIls(invoice.paidAtSaleAgorot)}`,
    remaining > 0 ? `الباقي: ${formatIls(remaining)}` : null,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

// Opens WhatsApp with a prepared message; nothing is sent until the person presses send there.
export function buildWhatsAppShareUrl(
  text: string,
  phoneE164: string | null,
): string {
  const target = phoneE164 ? phoneE164.replace(/^\+/, "") : "";
  return `https://wa.me/${target}?text=${encodeURIComponent(text)}`;
}
