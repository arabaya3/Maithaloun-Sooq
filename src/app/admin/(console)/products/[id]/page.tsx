import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { ArrowRight, ExternalLink } from "lucide-react";

import {
  adminCatalogService,
  auditLogService,
  catalogAuthoringService,
  inventoryService,
  productMaintenanceService,
  productOptionsService,
  sellingUnitService,
} from "@/features/admin/application/admin-services";
import { requireAdminSession } from "@/features/admin/auth/admin-session";
import type { AdminActor } from "@/features/admin/domain/admin-actor";
import { can } from "@/features/admin/domain/permissions";
import { productSaveMessage } from "@/features/admin/domain/product-save-feedback";
import {
  Money,
  Quantity,
  StickyAction,
  StockStatusPill,
} from "@/features/admin/ui/kit";
import { ProductCatalogControls } from "@/features/admin/ui/product-catalog-controls";
import { ProductForm } from "@/features/admin/ui/product-form";
import { AuditTimeline } from "@/features/admin/ui/audit-timeline";
import { wizardStepHref } from "@/features/admin/domain/product-wizard-steps";
import { WizardProgress } from "@/features/admin/ui/product-wizard";
import { ProductDangerZone } from "@/features/admin/ui/product-danger-zone";
import { ClearProductDraft } from "@/features/admin/ui/product-draft";
import { ProductMediaEditor } from "@/features/admin/ui/product-media-editor";
import { ProductReadiness } from "@/features/admin/ui/product-readiness";
import { SellingUnitsEditor } from "@/features/admin/ui/selling-units-editor";
import { WorkspaceNav } from "@/features/admin/ui/workspace-nav";
import { getProductDisplayName } from "@/features/catalog/domain/product";

export const metadata: Metadata = {
  title: "تعديل المنتج",
};

const publicationLabels = {
  published: "منشور",
  draft: "مسودة",
  hidden: "مخفي",
} as const;

// Reading stock lists every tracked variant, so this part streams in after the rest of the page.
async function InventorySummary({
  actor,
  productId,
  showCosts,
}: {
  actor: AdminActor;
  productId: string;
  showCosts: boolean;
}) {
  const stock = (await inventoryService.listStock(actor)).filter(
    (item) => item.productId === productId,
  );
  return stock.length ? (
    <ul className="admin-stock-summary">
      {stock.map((item) => (
        <li key={item.variantId}>
          <div className="admin-stock-summary-head">
            <strong>
              <bdi>{item.variantLabel ?? "الصنف الأساسي"}</bdi>
            </strong>
            <StockStatusPill status={item.status} />
          </div>
          {item.tracked ? (
            <dl className="admin-stock-summary-figures">
              <div>
                <dt>في المخزن</dt>
                <dd>
                  <Quantity milli={item.onHandMilli} unit={item.unit} />
                </dd>
              </div>
              <div>
                <dt>محجوز لطلبات</dt>
                <dd>
                  <Quantity milli={item.reservedMilli} unit={item.unit} />
                </dd>
              </div>
              <div>
                <dt>متاح للبيع</dt>
                <dd>
                  <Quantity milli={item.availableMilli} unit={item.unit} />
                </dd>
              </div>
              {showCosts && item.avgCostAgorot !== null ? (
                <div>
                  <dt>متوسط التكلفة</dt>
                  <dd>
                    <Money agorot={item.avgCostAgorot} />
                  </dd>
                </div>
              ) : null}
            </dl>
          ) : (
            <p className="admin-muted">لم يبدأ تتبّع مخزون هذا الصنف بعد.</p>
          )}
          <Link
            href={`/admin/inventory/stock/${item.variantId}`}
            prefetch={false}
          >
            الحركات والتعديل
          </Link>
        </li>
      ))}
    </ul>
  ) : (
    <p className="admin-muted">لا توجد أصناف فعّالة لهذا المنتج.</p>
  );
}

export default async function AdminProductEditPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    saved?: string | string[];
    at?: string | string[];
    guide?: string | string[];
  }>;
}) {
  await connection();
  const actor = await requireAdminSession();
  const product = await adminCatalogService.getByDomainId(
    actor,
    (await params).id,
  );
  if (!product) notFound();
  const canSeeStock = can(actor, "stock.view");
  const canManage = can(actor, "settings.manage");
  const isOwner = actor.role === "owner";
  const [
    matrix,
    archivedVariants,
    publicationCheck,
    sellingUnits,
    references,
    history,
  ] = await Promise.all([
    productOptionsService.matrix(product.id),
    catalogAuthoringService.archivedVariants(product.id),
    catalogAuthoringService.publicationCheck(product.id),
    sellingUnitService.listForProduct(product.id),
    canManage ? productMaintenanceService.references(actor, product.id) : null,
    isOwner
      ? auditLogService.list(actor, {
          entityType: "product",
          entityId: product.id,
        })
      : null,
  ]);
  const { saved, at, guide } = await searchParams;
  // Wizard steps 3–5 continue here, on the product's own workspace.
  const guideStep =
    guide === "images"
      ? 3
      : guide === "prices"
        ? 4
        : guide === "review"
          ? 5
          : null;
  const savedMessage = productSaveMessage(saved);
  const problems = publicationCheck?.problems ?? [];
  const showCosts = can(actor, "stock.costs");

  const sections = [
    { id: "overview", label: "نظرة عامة" },
    ...(matrix
      ? [
          { id: "variants", label: "الخيارات والأصناف" },
          { id: "images", label: "الصور" },
        ]
      : []),
    { id: "selling-units", label: "الأسعار وطرق البيع" },
    ...(canSeeStock ? [{ id: "inventory", label: "المخزون" }] : []),
    { id: "publication", label: "النشر" },
    ...(history ? [{ id: "history", label: "السجل" }] : []),
  ];

  return (
    <main className="admin-page admin-workspace">
      <header className="admin-workspace-header">
        <Link
          href="/admin/products"
          prefetch={false}
          className="admin-back-link"
        >
          <ArrowRight size={16} aria-hidden="true" />
          العودة إلى المنتجات
        </Link>
        <p className="admin-eyebrow">تعديل المنتج</p>
        <div className="admin-workspace-title">
          <h1>
            <bdi>{getProductDisplayName(product)}</bdi>
          </h1>
          <span className="admin-chip-row">
            <span
              className="admin-chip"
              data-tone={
                product.publication === "published" ? "success" : "neutral"
              }
            >
              {product.archived
                ? "مؤرشف"
                : publicationLabels[product.publication]}
            </span>
            {product.availability === "available" ? null : (
              <span className="admin-chip" data-tone="warning">
                غير متاح
              </span>
            )}
            {problems.length ? (
              <span className="admin-chip" data-tone="danger">
                {problems.length === 1
                  ? "نقطة واحدة قبل النشر"
                  : `${problems.length} نقاط قبل النشر`}
              </span>
            ) : null}
          </span>
        </div>
        {product.publication === "published" && !product.archived ? (
          <Link
            href={`/products/${product.slug}`}
            prefetch={false}
            className="admin-btn admin-btn-secondary admin-btn-sm admin-workspace-preview"
          >
            <ExternalLink size={16} aria-hidden="true" />
            عرض في المتجر
          </Link>
        ) : null}
      </header>

      {product.publication === "published" && problems.length ? (
        <section
          className="admin-media-message admin-incomplete-warning"
          data-tone="warning"
          aria-labelledby="incomplete-title"
        >
          <h2 id="incomplete-title">المنتج منشور لكنه غير مكتمل</h2>
          <p>
            قد يظهر للزبائن «غير متاح حالياً» حتى تُكملي هذه النقاط ثم تعيدي
            النشر:
          </p>
          <ul>
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </section>
      ) : null}
      {saved === "created" ? <ClearProductDraft /> : null}
      {savedMessage ? (
        <p className="admin-media-message" data-tone="ok" role="status">
          {savedMessage}
        </p>
      ) : null}

      {guideStep ? (
        <section
          className="admin-wizard-guide"
          aria-label="إكمال المنتج الجديد"
        >
          <WizardProgress current={guideStep} productId={product.id} />
          <p className="admin-muted">
            {guideStep === 3
              ? "أضيفي الصور واربطي كل صورة بالرائحة أو الحجم أو اللون الذي تخصه."
              : guideStep === 4
                ? "راجعي سعر كل صنف وطرق البيع، ثم سجّلي الكمية الافتتاحية لكل صنف من قسم المخزون."
                : "راجعي ما ينقص قبل النشر، ثم اختاري حالة المنتج."}
          </p>
        </section>
      ) : null}

      <WorkspaceNav sections={sections} label="أقسام المنتج" />

      <section
        id="overview"
        className="admin-workspace-section"
        aria-labelledby="workspace-overview-title"
      >
        <h2
          id="workspace-overview-title"
          className="admin-workspace-section-title"
        >
          نظرة عامة
        </h2>
        <ProductForm
          key={typeof at === "string" ? at : "initial"}
          product={product}
          sortOrder={product.sortOrder}
          mode="edit"
        />
      </section>

      {/* These editors name their own region and heading; the wrappers are only jump targets. */}
      {matrix ? (
        <div id="variants" className="admin-workspace-anchor">
          <ProductMediaEditor
            matrix={matrix}
            storefrontHref={`/products/${product.slug}`}
          />
        </div>
      ) : null}

      <div id="selling-units" className="admin-workspace-anchor">
        <SellingUnitsEditor
          productDomainId={product.id}
          variants={sellingUnits}
        />
      </div>

      {canSeeStock ? (
        <section
          id="inventory"
          className="admin-workspace-section"
          aria-labelledby="workspace-inventory-title"
        >
          <h2
            id="workspace-inventory-title"
            className="admin-workspace-section-title"
          >
            المخزون
          </h2>
          <Suspense
            fallback={
              <div
                className="admin-skeleton admin-skeleton-stock"
                aria-hidden="true"
              />
            }
          >
            <InventorySummary
              actor={actor}
              productId={product.id}
              showCosts={showCosts}
            />
          </Suspense>
        </section>
      ) : null}
      <div id="publication" className="admin-workspace-anchor">
        {publicationCheck ? (
          <ProductReadiness
            check={publicationCheck}
            publication={product.publication}
            hasOptions={Boolean(
              matrix?.options.some((option) => !option.archived),
            )}
          />
        ) : null}
        <ProductCatalogControls
          domainId={product.id}
          publication={product.publication}
          problems={problems}
          placeholderImage={publicationCheck?.acceptedPlaceholder ?? false}
          variants={product.variants.map((variant) => ({
            id: variant.id,
            labelAr: variant.labelAr,
            sku: variant.sku,
            barcode: variant.barcode,
          }))}
          archivedVariants={archivedVariants}
        />
      </div>

      {canManage && references ? (
        <div id="danger" className="admin-workspace-anchor">
          <ProductDangerZone
            domainId={product.id}
            name={product.nameAr}
            references={references}
            archived={product.archived}
          />
        </div>
      ) : null}
      {history ? (
        <section
          id="history"
          className="admin-workspace-section"
          aria-labelledby="workspace-history-title"
        >
          <h2
            id="workspace-history-title"
            className="admin-workspace-section-title"
          >
            السجل
          </h2>
          {history.entries.length ? (
            <AuditTimeline entries={history.entries.slice(0, 10)} />
          ) : (
            <p className="admin-muted">لا توجد تغييرات مسجّلة بعد.</p>
          )}
          <Link href="/admin/audit?entity=product" prefetch={false}>
            كل سجل المنتجات
          </Link>
        </section>
      ) : null}

      {guideStep ? (
        <StickyAction>
          <div className="admin-wizard-nav">
            <Link
              href={wizardStepHref(guideStep - 1, product.id)!}
              prefetch={false}
              className="admin-btn admin-btn-secondary"
            >
              السابق
            </Link>
            <Link
              href={
                guideStep < 5
                  ? wizardStepHref(guideStep + 1, product.id)!
                  : "/admin/products"
              }
              prefetch={false}
              className="admin-btn admin-btn-primary"
            >
              {guideStep === 3
                ? "التالي: الأسعار والمخزون"
                : guideStep === 4
                  ? "التالي: المراجعة"
                  : "إنهاء والعودة إلى المنتجات"}
            </Link>
          </div>
        </StickyAction>
      ) : null}
    </main>
  );
}
