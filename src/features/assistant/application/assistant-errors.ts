import "server-only";

import { AdminCatalogError } from "@/features/admin/application/admin-catalog-service";
import {
  mapOrderAdminError,
  mapProductAdminError,
} from "@/features/admin/application/admin-action-errors";
import { AdminOrderError } from "@/features/admin/application/admin-order-service";
import { ProductMaintenanceError } from "@/features/admin/application/product-maintenance-service";
import { CatalogAuthoringError } from "@/features/admin/application/catalog-authoring-service";
import { AuthorizationError } from "@/features/admin/domain/admin-actor";
import {
  mapExtractionError,
  mapInventoryError,
} from "@/features/inventory/application/inventory-action-errors";
import { InventoryError } from "@/features/inventory/application/stock-ledger";
import { ExtractionError } from "@/features/purchasing/application/extraction-service";
import { mapSalesError } from "@/features/sales/application/sales-action-errors";
import { SalesError } from "@/features/sales/application/sales-service";
import { errorCode } from "@/server/log/ops-log";

import type { ConfirmationRejection } from "../domain/confirmation-token";
import { authoringMessage } from "./catalog-operations";

const maintenanceMessages: Record<ProductMaintenanceError["code"], string> = {
  not_found: "المنتج غير موجود.",
  invalid_input: "بيانات العملية غير صالحة.",
  in_use: "المنتج مرتبط بسجلات، لذلك لا يمكن حذفه. أرشفيه بدلاً من ذلك.",
  archived: "المنتج مؤرشف مسبقاً.",
  reserved_stock: "على المنتج كميات محجوزة لطلبات مفتوحة.",
  same_product: "المنتجان نفس المنتج.",
};

export const rejectionMessages: Record<ConfirmationRejection, string> = {
  not_found: "هذه العملية غير موجودة.",
  wrong_owner: "هذه العملية ليست لحسابك.",
  wrong_operation: "نوع العملية لا يطابق البطاقة.",
  bad_token: "انتهت صلاحية البطاقة. حدّثيها ثم أكّدي من جديد.",
  expired: "انتهت مدة التأكيد. اطلبي العملية من جديد.",
  already_used: "تم التعامل مع هذه البطاقة مسبقاً.",
  tampered: "تغيّرت بيانات العملية، لذلك أُلغيت.",
  stale:
    "تغيّرت البيانات منذ تجهيز البطاقة (سعر أو كمية أو حالة). اطلبي العملية من جديد لتري القيم الحالية.",
  not_acknowledged:
    "الحذف النهائي يحتاج تأكيد أنك فهمتِ أنه لا يمكن التراجع عنه.",
  token_stale: "مرّ وقت على فتح بطاقة الحذف. حدّثي البطاقة ثم أكّدي من جديد.",
};

export function assistantFailure(error: unknown): {
  code: string;
  message: string;
} {
  const code = errorCode(error);
  if (error instanceof AuthorizationError) {
    return { code, message: "ليست لديك صلاحية لهذا الإجراء." };
  }
  if (error instanceof ProductMaintenanceError) {
    return { code, message: maintenanceMessages[error.code] };
  }
  if (error instanceof CatalogAuthoringError) {
    return { code, message: authoringMessage(error) };
  }
  if (error instanceof Error && error.message === "attachment_missing") {
    return { code, message: "الصورة المرفقة لم تعد متاحة. أعيدي إرفاقها." };
  }
  if (error instanceof AdminCatalogError) {
    return { code, message: mapProductAdminError(error) };
  }
  if (error instanceof AdminOrderError) {
    return { code, message: mapOrderAdminError(error) };
  }
  if (error instanceof SalesError)
    return { code, message: mapSalesError(error) };
  if (error instanceof InventoryError) {
    return { code, message: mapInventoryError(error) };
  }
  if (error instanceof ExtractionError) {
    return { code, message: mapExtractionError(error) };
  }
  if (error instanceof Error && error.message.startsWith("STORAGE_")) {
    return { code, message: "تعذّر حفظ الملف في التخزين. أعيدي المحاولة." };
  }
  return {
    code,
    message: "تعذّر تنفيذ العملية. لم يتغيّر شيء أو تحققي من السجل.",
  };
}
