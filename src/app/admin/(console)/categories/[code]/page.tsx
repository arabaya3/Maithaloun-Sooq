import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import {
  adminCatalogService,
  catalogAuthoringService,
} from "@/features/admin/application/admin-services";
import { requireAdminSession } from "@/features/admin/auth/admin-session";
import { can } from "@/features/admin/domain/permissions";
import { CategoryProductMover } from "@/features/admin/ui/category-product-mover";
import { PageHeader } from "@/features/admin/ui/kit";
import { getProductDisplayName } from "@/features/catalog/domain/product";

export const metadata: Metadata = { title: "منتجات القسم" };

const publicationLabels = {
  published: "منشور",
  draft: "مسودة",
  hidden: "مخفي",
} as const;

export default async function CategoryProductsPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  await connection();
  const actor = await requireAdminSession();
  const header = (
    <PageHeader
      title="نقل منتجات القسم"
      back={{ href: "/admin/categories", label: "الأقسام" }}
    />
  );
  if (!can(actor, "settings.manage")) {
    return (
      <main className="admin-page admin-page--narrow">
        {header}
        <p className="admin-note" role="note">
          إدارة الأقسام للمالك فقط.
        </p>
      </main>
    );
  }
  const { code } = await params;
  if (!/^[a-z0-9-]{2,40}$/.test(code)) notFound();
  const [categories, products, offers] = await Promise.all([
    catalogAuthoringService.listCategories(false),
    adminCatalogService.list(actor),
    catalogAuthoringService.offersNamingCategory(code),
  ]);
  const category = categories.find((entry) => entry.code === code);
  if (!category) notFound();

  return (
    <main className="admin-page admin-page--narrow">
      {header}
      <p className="admin-muted">
        اختاري المنتجات ثم القسم الجديد. يُنقل المنتج بكل أصنافه وصوره ومخزونه
        كما هي، ويُسجَّل النقل في السجل.
      </p>
      {offers.length ? (
        <p className="admin-note" role="note">
          {offers.map((name) => `«${name}»`).join("، ")} مربوط بهذا القسم.
          المنتجات المنقولة منه لن يشملها هذا العرض بعد النقل.
        </p>
      ) : null}
      <CategoryProductMover
        categoryName={category.nameAr}
        products={products
          .filter((product) => product.categoryId === code)
          .map((product) => ({
            id: product.id,
            name: getProductDisplayName(product),
            status: publicationLabels[product.publication],
          }))}
        targets={categories
          .filter((entry) => entry.code !== code)
          .map((entry) => ({ code: entry.code, nameAr: entry.nameAr }))}
      />
    </main>
  );
}
