import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { AdminCatalogService } from "@/features/admin/application/admin-catalog-service";
import { AdminOrderService } from "@/features/admin/application/admin-order-service";
import { CatalogAuthoringService } from "@/features/admin/application/catalog-authoring-service";
import { ProductMaintenanceService } from "@/features/admin/application/product-maintenance-service";
import { SellingUnitService } from "@/features/admin/application/selling-unit-service";
import type { AdminActor } from "@/features/admin/domain/admin-actor";
import { AssistantOperations } from "@/features/assistant/application/assistant-operations";
import { AttachmentService } from "@/features/assistant/application/attachment-service";
import { ConfirmationService } from "@/features/assistant/application/confirmation-service";
import { ConversationRepository } from "@/features/assistant/application/conversation-repository";
import { ToolRunLog } from "@/features/assistant/application/tool-run-log";
import { InventoryService } from "@/features/inventory/application/inventory-service";
import { ExtractionService } from "@/features/purchasing/application/extraction-service";
import { PurchaseService } from "@/features/purchasing/application/purchase-service";
import { ReportService } from "@/features/reports/application/report-service";
import { SupplierService } from "@/features/purchasing/application/supplier-service";
import { OfferService } from "@/features/offers/application/offer-service";
import { SupplierMaintenanceService } from "@/features/purchasing/application/supplier-maintenance-service";
import { CustomerMaintenanceService } from "@/features/sales/application/customer-maintenance-service";
import { CustomerService } from "@/features/sales/application/customer-service";
import { SalesService } from "@/features/sales/application/sales-service";
import { createAssistantAgent } from "@/server/ai/assistant-agent";
import { createProductImageAnalyzer } from "@/server/ai/product-image-analyzer";
import { adminAssistantConfirmations, products } from "@/server/db/schema";
import {
  resetTestDatabase,
  testDatabaseConnection,
} from "@/test/test-database";

import { createOwnerActor } from "./support";

// Runs the real model against the local test database only when explicitly requested; it never confirms anything.
const enabled =
  process.env.ASSISTANT_MODEL_SMOKE === "1" &&
  Boolean(process.env.OPENAI_API_KEY);

const { db } = testDatabaseConnection;

describe.skipIf(!enabled)("real model smoke (read and prepare only)", () => {
  let owner: AdminActor;
  const unavailable = () => {
    throw new Error("not used");
  };
  const catalog = new AdminCatalogService(db);
  const authoring = new CatalogAuthoringService(db);
  const inventory = new InventoryService(db);
  const purchases = new PurchaseService(db);
  const customers = new CustomerService(db);
  const attachments = new AttachmentService(db, unavailable);
  const conversations = new ConversationRepository(db);
  const toolRuns = new ToolRunLog(db);
  const operations = new AssistantOperations({
    database: db,
    catalog,
    authoring,
    maintenance: new ProductMaintenanceService(db),
    sellingUnits: new SellingUnitService(db),
    inventory,
    sales: new SalesService(db),
    customers,
    customerMaintenance: new CustomerMaintenanceService(db),
    suppliers: new SupplierService(db),
    supplierMaintenance: new SupplierMaintenanceService(db),
    offers: new OfferService(db),
    orders: new AdminOrderService(db),
    extraction: new ExtractionService(db, purchases, unavailable),
    attachments,
    productImages: unavailable,
    invoiceExtractor: unavailable,
  });
  const confirmations = new ConfirmationService(
    db,
    operations,
    conversations,
    toolRuns,
  );

  beforeAll(async () => {
    await resetTestDatabase();
    owner = await createOwnerActor();
  });

  it("answers a read question and prepares, but does not apply, a harmless rename", async () => {
    const conversationId = await conversations.ensure(owner, null);
    const agent = createAssistantAgent({
      actor: owner,
      conversationId,
      mode: "full",
      database: db,
      catalog,
      authoring,
      attachments,
      imageAnalyzer: createProductImageAnalyzer,
      offers: new OfferService(db),
      customerMaintenance: new CustomerMaintenanceService(db),
      suppliers: new SupplierService(db),
      supplierMaintenance: new SupplierMaintenanceService(db),
      inventory,
      orders: new AdminOrderService(db),
      customers,
      sales: new SalesService(db),
      reports: new ReportService(db, customers, inventory),
      purchases,
      operations,
      confirmations,
      toolRuns,
    });

    const read = await agent.generate({ prompt: "شو أقسام المتجر؟" });
    expect(
      read.steps.flatMap((step) => step.toolCalls.map((call) => call.toolName)),
    ).toContain("listCategories");

    const prepare = await agent.generate({
      prompt: "غيري اسم فرشاة سجاد إلى فرشاة سجاد للاختبار",
    });
    const calls = prepare.steps.flatMap((step) =>
      step.toolCalls.map((call) => call.toolName),
    );
    expect(calls).toContain("prepareProductUpdate");
    const pending = await db
      .select()
      .from(adminAssistantConfirmations)
      .where(eq(adminAssistantConfirmations.status, "pending"));
    expect(pending).toHaveLength(1);
    const [brush] = await db
      .select({ nameAr: products.nameAr })
      .from(products)
      .where(eq(products.domainId, "carpet-brush"));
    expect(brush?.nameAr).toBe("فرشاة سجاد");
    await confirmations.cancel(owner, pending[0]!.id);
  }, 120_000);
});
