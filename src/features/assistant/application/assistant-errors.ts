import "server-only";

import { AdminCatalogError } from "@/features/admin/application/admin-catalog-service";
import {
  mapOrderAdminError,
  mapProductAdminError,
} from "@/features/admin/application/admin-action-errors";
import { AdminOrderError } from "@/features/admin/application/admin-order-service";
import { ProductMaintenanceError } from "@/features/admin/application/product-maintenance-service";
import {
  SellingUnitError,
  sellingUnitErrorMessages,
} from "@/features/admin/application/selling-unit-service";
import { OfferError } from "@/features/offers/application/offer-service";
import { ProductOptionsError } from "@/features/admin/application/product-options-service";
import { SupplierMaintenanceError } from "@/features/purchasing/application/supplier-maintenance-service";
import { SupplierError } from "@/features/purchasing/application/supplier-service";
import { CustomerMaintenanceError } from "@/features/sales/application/customer-maintenance-service";
import { CustomerError } from "@/features/sales/application/customer-service";
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
import { optionErrorMessages } from "./media-operations";

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
  if (code === "amount_ambiguous") {
    return {
      code,
      message:
        "المبلغ في رسالتك غير واضح أو فيه أكثر من قيمة؛ ما جهّزت شي. اكتبي المبلغ الصحيح.",
    };
  }
  if (error instanceof ProductOptionsError) {
    return { code: error.code, message: optionErrorMessages[error.code] };
  }
  if (error instanceof AuthorizationError) {
    return { code, message: "ليست لديك صلاحية لهذا الإجراء." };
  }
  if (error instanceof SellingUnitError) {
    return { code: error.code, message: sellingUnitErrorMessages[error.code] };
  }
  if (error instanceof ProductMaintenanceError) {
    return { code, message: maintenanceMessages[error.code] };
  }
  if (error instanceof OfferError) {
    const offerMessages: Record<OfferError["code"], string> = {
      not_found: "العرض غير موجود.",
      invalid_input: "بيانات العرض غير صالحة.",
      invalid_price: "العرض يجعل سعر أحد الأصناف صفراً أو لا يخفّضه.",
      conflict: "يتعارض مع عرض مفعّل آخر على نفس الأصناف في نفس الفترة.",
      in_use: "العرض مستخدم في طلبات، لذلك لا يُحذف.",
      empty_target: "العرض لا يشمل أي صنف.",
    };
    return { code, message: offerMessages[error.code] };
  }
  if (
    error instanceof CustomerMaintenanceError ||
    error instanceof CustomerError
  ) {
    const customerMessages: Record<string, string> = {
      not_found: "الزبون غير موجود.",
      invalid_input: "بيانات الزبون غير صالحة.",
      invalid_phone: "رقم الواتساب غير صحيح.",
      duplicate: "يوجد زبون بنفس الاسم.",
      same_customer: "الزبونان نفس الشخص.",
      in_use: "الزبون مرتبط بسجلات، لذلك لا يُحذف.",
      merged: "أحد الزبونين مدموج أو مؤرشف.",
    };
    return {
      code,
      message:
        customerMessages[error.code] ?? "تعذّر تنفيذ العملية على الزبون.",
    };
  }
  if (
    error instanceof SupplierMaintenanceError ||
    error instanceof SupplierError
  ) {
    const supplierMessages: Record<string, string> = {
      not_found: "المورد غير موجود.",
      invalid_input: "بيانات المورد غير صالحة.",
      duplicate: "الاسم مستخدم مسبقاً.",
      same_supplier: "المورّدان نفس المورد.",
      in_use: "المورد مرتبط بسجلات، لذلك لا يُحذف.",
      merged: "أحد الموردين مدموج أو مؤرشف.",
      payment_exceeds_balance: "الدفعة أكبر من المستحق للمورد.",
    };
    return {
      code,
      message:
        supplierMessages[error.code] ?? "تعذّر تنفيذ العملية على المورد.",
    };
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
