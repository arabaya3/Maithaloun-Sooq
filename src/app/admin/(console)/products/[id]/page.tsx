import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import {
  adminCatalogService,
  catalogAuthoringService,
  productOptionsService,
  sellingUnitService,
} from "@/features/admin/application/admin-services";
import { requireAdminSession } from "@/features/admin/auth/admin-session";
import { productSaveMessage } from "@/features/admin/domain/product-save-feedback";
import { ProductCatalogControls } from "@/features/admin/ui/product-catalog-controls";
import { ProductForm } from "@/features/admin/ui/product-form";
import { ProductMediaEditor } from "@/features/admin/ui/product-media-editor";
import { SellingUnitsEditor } from "@/features/admin/ui/selling-units-editor";

export const metadata: Metadata = {
  title: "تعديل المنتج",
};

export default async function AdminProductEditPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string | string[]; at?: string | string[] }>;
}) {
  await connection();
  const actor = await requireAdminSession();
  const product = await adminCatalogService.getByDomainId(
    actor,
    (await params).id,
  );
  if (!product) notFound();
  const [matrix, archivedVariants, publicationCheck, sellingUnits] =
    await Promise.all([
      productOptionsService.matrix(product.id),
      catalogAuthoringService.archivedVariants(product.id),
      catalogAuthoringService.publicationCheck(product.id),
      sellingUnitService.listForProduct(product.id),
    ]);
  const { saved, at } = await searchParams;
  const savedMessage = productSaveMessage(saved);

  return (
    <main className="admin-page">
      <p>
        <Link href="/admin/products" prefetch={false}>
          العودة إلى المنتجات
        </Link>
      </p>
      <h1>تعديل المنتج</h1>
      <p className="admin-muted">{product.nameAr}</p>
      {savedMessage ? (
        <p className="admin-media-message" data-tone="ok" role="status">
          {savedMessage}
        </p>
      ) : null}
      <ProductForm
        key={typeof at === "string" ? at : "initial"}
        product={product}
        sortOrder={product.sortOrder}
        mode="edit"
      />
      <ProductCatalogControls
        domainId={product.id}
        publication={product.publication}
        problems={publicationCheck?.problems ?? []}
        placeholderImage={publicationCheck?.acceptedPlaceholder ?? false}
        variants={product.variants.map((variant) => ({
          id: variant.id,
          labelAr: variant.labelAr,
          sku: variant.sku,
          barcode: variant.barcode,
        }))}
        archivedVariants={archivedVariants}
      />
      <SellingUnitsEditor
        productDomainId={product.id}
        variants={sellingUnits}
      />
      {matrix ? (
        <ProductMediaEditor
          matrix={matrix}
          storefrontHref={`/products/${product.slug}`}
        />
      ) : null}
    </main>
  );
}
