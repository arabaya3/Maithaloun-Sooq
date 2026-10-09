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
import { Money, Quantity, StockStatusPill } from "@/features/admin/ui/kit";
import { ProductCatalogControls } from "@/features/admin/ui/product-catalog-controls";
import { AuditTimeline } from "@/features/admin/ui/audit-timeline";
import { ProductDangerZone } from "@/features/admin/ui/product-danger-zone";
import { ClearProductDraft } from "@/features/admin/ui/product-draft";
import { ProductMediaEditor } from "@/features/admin/ui/product-media-editor";
import { ProductReadiness } from "@/features/admin/ui/product-readiness";
import { ProductForm } from "@/features/admin/ui/product-form";
import { SellingUnitsEditor } from "@/features/admin/ui/selling-units-editor";
import { simpleEditorState } from "@/features/admin/domain/simple-product";
import { SimpleProductEditor } from "@/features/admin/ui/simple-product-editor";
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
    advanced?: string | string[];
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
    stockRows,
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
    canSeeStock
      ? inventoryService
          .listStock(actor)
          .then((rows) => rows.filter((row) => row.productId === product.id))
      : [],
  ]);
  const { saved, advanced } = await searchParams;
  const savedMessage =
    saved === "ok"
      ? "تم حفظ المنتج."
      : saved === "partial"
        ? null
        : productSaveMessage(saved);
  const problems = publicationCheck?.problems ?? [];
  const showCosts = can(actor, "stock.costs");
  const simple = matrix
    ? simpleEditorState(
        matrix,
        new Set(
          stockRows.filter((row) => row.tracked).map((row) => row.variantId),
        ),
      )
    : null;
  const published = product.publication === "published";

  return (
    <main className="admin-page admin-page--narrow admin-workspace sp-page">
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
              data-tone={published ? "success" : "neutral"}
            >
              {product.archived
                ? "مؤرشف"
                : published
                  ? "ظاهر في المتجر"
                  : publicationLabels[product.publication]}
            </span>
          </span>
        </div>
        {published && !product.archived ? (
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

      {saved === "created" || saved === "ok" ? <ClearProductDraft /> : null}
      {savedMessage ? (
        <p className="sp-note" data-tone="ok" role="status">
          {savedMessage}
        </p>
      ) : null}
      {saved === "partial" ? (
        <p className="sp-note" data-tone="warning" role="alert">
          حُفظ المنتج كمسودة، لكن لم يكتمل كل شيء. راجعي الصور والأسعار ثم اضغطي
          حفظ مرة أخرى.
        </p>
      ) : null}
      {problems.length && (published || saved) ? (
        <section
          className="sp-note"
          data-tone="warning"
          aria-labelledby="incomplete-title"
        >
          <h2 id="incomplete-title" className="sp-note-title">
            {published
              ? "المنتج منشور لكن ينقصه:"
              : "حتى يظهر في المتجر ينقصه:"}
          </h2>
          <ul>
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {canManage && simple && !product.archived ? (
        <SimpleProductEditor
          key={product.id}
          canStock={can(actor, "stock.adjust")}
          lockedMessage={
            simple.locked
              ? "لهذا المنتج أكثر من نوع اختلاف (مثل رائحة وحجم معاً). عدّلي الأنواع وصورها من «إعدادات متقدمة» في الأسفل."
              : undefined
          }
          initial={{
            productId: product.id,
            nameAr: product.nameAr,
            categoryId: product.categoryId,
            description: product.description ?? "",
            kind: simple.kind,
            optionName: simple.optionName,
            rows: simple.rows,
            generalImages: simple.generalImages,
            published,
          }}
        />
      ) : null}

      <details
        className="sp-advanced"
        open={
          Boolean(advanced) ||
          !canManage ||
          Boolean(simple?.locked) ||
          product.archived
        }
      >
        <summary>إعدادات متقدمة</summary>
        <p className="sp-muted">
          الباركود، العبوات والكراتين، المخزون، النشر، والحذف. لا تحتاجينها
          لإضافة منتج عادي.
        </p>

        <section
          id="overview"
          className="admin-workspace-section"
          aria-labelledby="workspace-overview-title"
        >
          <h2
            id="workspace-overview-title"
            className="admin-workspace-section-title"
          >
            تفاصيل إضافية
          </h2>
          <ProductForm
            product={product}
            sortOrder={product.sortOrder}
            mode="edit"
          />
        </section>

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
      </details>
    </main>
  );
}
