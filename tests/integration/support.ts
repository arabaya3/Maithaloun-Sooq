import { eq } from "drizzle-orm";

import { OwnerService } from "@/features/admin/auth/owner-service";
import type { AdminActor } from "@/features/admin/domain/admin-actor";
import { checkoutRequestSchema } from "@/features/orders/domain/checkout-request";
import { adminUsers } from "@/server/db/schema";
import { testDatabaseConnection } from "@/test/test-database";
import { parseTestAdminEnv } from "@/test/test-admin";

const { db } = testDatabaseConnection;

export function checkoutRequest(
  items: { productId: string; quantity: number }[],
) {
  return checkoutRequestSchema.parse({
    idempotencyKey: crypto.randomUUID(),
    customerName: "عميل تجريبي",
    whatsappCountryCode: "970",
    whatsappNationalNumber: "0591234567",
    serviceAreaCode: "maythalun",
    deliveryAddress: "عنوان محلي مفصل للاختبار",
    paymentMethod: "cash_on_delivery",
    honeypot: "",
    items: items.map((item) => ({
      productId: item.productId,
      variantId: `${item.productId}--default`,
      quantity: item.quantity,
    })),
  });
}

export async function createOwnerActor(): Promise<AdminActor> {
  const admin = parseTestAdminEnv({
    TEST_ADMIN_USERNAME: process.env.TEST_ADMIN_USERNAME,
    TEST_ADMIN_PASSWORD: process.env.TEST_ADMIN_PASSWORD,
    TEST_ADMIN_DISPLAY_NAME: process.env.TEST_ADMIN_DISPLAY_NAME,
  });
  const created = await new OwnerService(db).createTestOwner({
    username: admin.TEST_ADMIN_USERNAME,
    displayName: admin.TEST_ADMIN_DISPLAY_NAME,
    password: admin.TEST_ADMIN_PASSWORD,
    databaseName: "maithalun_test",
  });
  return {
    id: created.id,
    username: created.username,
    displayName: admin.TEST_ADMIN_DISPLAY_NAME,
    role: "owner",
    active: true,
  };
}

export async function createOperatorActor(): Promise<AdminActor> {
  const username = "test-operator";
  await db
    .insert(adminUsers)
    .values({
      username,
      displayName: "موظفة الاختبار",
      passwordHash: "not-a-login-hash",
      role: "operator",
    })
    .onConflictDoNothing({ target: adminUsers.username });
  const [row] = await db
    .select({ id: adminUsers.id })
    .from(adminUsers)
    .where(eq(adminUsers.username, username));
  return {
    id: row!.id,
    username,
    displayName: "موظفة الاختبار",
    role: "operator",
    active: true,
  };
}

export const OPERATIONS_TABLES = [
  "customer_ledger_entries",
  "customer_payments",
  "customer_invoice_lines",
  "customer_invoices",
  "customer_aliases",
  "customers",
  "price_reviews",
  "stock_movements",
  "stock_reservations",
  "inventory_adjustments",
  "supplier_ledger_entries",
  "supplier_product_aliases",
  "extraction_job_lines",
  "extraction_job_documents",
  "purchase_invoice_items",
  "purchase_invoices",
  "extraction_jobs",
  "document_uploads",
  "inventory_items",
  "suppliers",
  "order_status_history",
  "admin_audit_events",
  "orders",
];
