import { z } from "zod";

import { offerKinds } from "@/features/catalog/domain/offer-pricing";
import { parseIlsToAgorot } from "@/shared/lib/parse-ils";
import { addDays, startOfStoreDay } from "@/shared/lib/store-time";

import type { OfferInput } from "./offer-service";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const domainId = /^[a-z0-9-]{1,100}$/;

const text = (value: FormDataEntryValue | null) =>
  typeof value === "string" ? value.trim() : "";

const ids = (formData: FormData, name: string) =>
  formData
    .getAll(name)
    .map((value) => text(value))
    .filter((value) => domainId.test(value));

/** Reads the editor. Dates are whole store days: the offer ends at the start of the day after «حتى». */
export function readOfferForm(
  formData: FormData,
): { input: OfferInput } | { message: string } {
  const kind = z.enum(offerKinds).safeParse(formData.get("kind"));
  if (!kind.success) return { message: "اختاري نوع العرض." };
  const rawValue = text(formData.get("value"));
  const value =
    kind.data === "percentage"
      ? /^\d{1,2}$/.test(rawValue)
        ? Number(rawValue)
        : null
      : parseIlsToAgorot(rawValue);
  if (value === null || value <= 0) {
    return {
      message:
        kind.data === "percentage"
          ? "اكتبي نسبة الخصم رقماً صحيحاً من 1 إلى 90."
          : "اكتبي المبلغ بالشيكل، مثل 5 أو 2.50.",
    };
  }
  if (kind.data === "percentage" && value > 90) {
    return { message: "أعلى نسبة خصم مسموحة 90٪." };
  }
  const minQuantity = Number(text(formData.get("minQuantity")) || "1");
  if (!Number.isInteger(minQuantity) || minQuantity < 1 || minQuantity > 100) {
    return { message: "أقل كمية للعرض رقم صحيح من 1 إلى 100." };
  }
  const startDate = text(formData.get("startDate"));
  const endDate = text(formData.get("endDate"));
  if (
    (startDate && !DATE.test(startDate)) ||
    (endDate && !DATE.test(endDate))
  ) {
    return { message: "تاريخ غير صالح." };
  }
  if (startDate && endDate && endDate < startDate) {
    return { message: "تاريخ النهاية قبل تاريخ البداية." };
  }
  const nameAr = text(formData.get("nameAr"));
  if (nameAr.length < 2 || nameAr.length > 80) {
    return { message: "اكتبي اسماً للعرض من 2 إلى 80 حرفاً." };
  }
  const displayText = text(formData.get("displayText"));
  if (displayText.length > 120) {
    return { message: "نص العرض في المتجر 120 حرفاً على الأكثر." };
  }
  return {
    input: {
      nameAr,
      displayText: displayText || null,
      kind: kind.data,
      value,
      minQuantity,
      startsAt: startDate ? startOfStoreDay(startDate) : null,
      endsAt: endDate ? startOfStoreDay(addDays(endDate, 1)) : null,
      enabled: formData.get("enabled") === "on",
      targets: {
        productIds: ids(formData, "productIds"),
        variantIds: ids(formData, "variantIds"),
        categoryCodes: ids(formData, "categoryCodes"),
      },
    },
  };
}
