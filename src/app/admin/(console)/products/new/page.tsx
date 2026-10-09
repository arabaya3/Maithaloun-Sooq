import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Camera, ReceiptText } from "lucide-react";
import { connection } from "next/server";

import {
  adminCatalogService,
  catalogAuthoringService,
  productOptionsService,
} from "@/features/admin/application/admin-services";
import { requireAdminSession } from "@/features/admin/auth/admin-session";
import { can } from "@/features/admin/domain/permissions";
import { formatAdminDateTime } from "@/features/admin/ui/format-admin-datetime";
import { PageHeader } from "@/features/admin/ui/kit";
import { ClearProductDraft } from "@/features/admin/ui/product-draft";
import {
  BasicInfoStep,
  ConfiguredOptions,
  OptionsStep,
  SavedBasics,
  WizardProgress,
} from "@/features/admin/ui/product-wizard";
import { formatIls } from "@/shared/lib/format-currency";

export const metadata: Metadata = { title: "منتج جديد" };

const PRODUCT_ID = /^[a-z0-9-]{1,80}$/;

export default async function AdminProductWizardPage({
  searchParams,
}: {
  searchParams: Promise<{ product?: string; step?: string }>;
}) {
  await connection();
  const actor = await requireAdminSession();
  const params = await searchParams;
  const productId =
    params.product && PRODUCT_ID.test(params.product) ? params.product : null;

  if (!productId) {
    return (
      <main className="admin-page admin-page--narrow admin-wizard">
        <PageHeader
          title="منتج جديد"
          lede="خمس خطوات قصيرة. يُحفظ المنتج كمسودة لا يراها الزبائن حتى تنشريه."
          back={{ href: "/admin/products", label: "العودة إلى المنتجات" }}
        />
        <WizardProgress current={1} productId={null} />
        <BasicInfoStep />
        <nav className="admin-wizard-other" aria-label="طرق أخرى للبدء">
          <Link href="/admin/products/new/photo" prefetch={false}>
            <Camera size={18} aria-hidden="true" /> تصوير العبوة وقراءة بياناتها
          </Link>
          <Link
            href={
              can(actor, "purchase.record")
                ? "/admin/inventory/capture"
                : "/admin/inventory/purchases"
            }
            prefetch={false}
          >
            <ReceiptText size={18} aria-hidden="true" /> من فاتورة شراء
          </Link>
        </nav>
      </main>
    );
  }

  const [product, matrix, version, categories] = await Promise.all([
    adminCatalogService.getByDomainId(actor, productId),
    productOptionsService.matrix(productId),
    catalogAuthoringService.productVersion(productId),
    catalogAuthoringService.listCategories(true),
  ]);
  if (!product || !matrix || !version) notFound();
  const step = params.step === "1" ? 1 : 2;
  const liveOptions = matrix.options.filter((option) => !option.archived);
  const liveVariants = matrix.variants.filter((variant) => !variant.archived);
  const configured = liveOptions.length > 0 || liveVariants.length > 1;
  const savedAt = formatAdminDateTime(version.split("|")[0]!);

  return (
    <main className="admin-page admin-page--narrow admin-wizard">
      <PageHeader
        title={product.nameAr}
        lede={`مسودة · آخر حفظ ${savedAt}`}
        back={{ href: "/admin/products", label: "العودة إلى المنتجات" }}
      />
      {/* Once the draft is on the server, this device stops offering its local copy. */}
      <ClearProductDraft />
      <WizardProgress current={step} productId={productId} />
      {step === 1 ? (
        <SavedBasics
          productId={productId}
          nameAr={product.nameAr}
          category={
            categories.find((category) => category.code === product.categoryId)
              ?.nameAr ?? product.categoryId
          }
          price={formatIls(product.priceAgorot)}
          savedAt={savedAt}
        />
      ) : configured ? (
        <ConfiguredOptions
          productId={productId}
          options={liveOptions.map((option) => ({
            nameAr: option.nameAr,
            values: option.values.map((value) => value.valueAr),
          }))}
          variantCount={liveVariants.length}
        />
      ) : (
        <OptionsStep
          productId={productId}
          priceLabel={formatIls(product.priceAgorot)}
        />
      )}
    </main>
  );
}
