import type { Metadata } from "next";
import Link from "next/link";
import { Archive, PackageSearch, Plus } from "lucide-react";
import { connection } from "next/server";

import {
  adminCatalogService,
  catalogAuthoringService,
  inventoryService,
} from "@/features/admin/application/admin-services";
import { requireAdminSession } from "@/features/admin/auth/admin-session";
import { can } from "@/features/admin/domain/permissions";
import { EmptyState, PageHeader } from "@/features/admin/ui/kit";
import {
  ArchivedProductList,
  ProductList,
  type ProductListRow,
} from "@/features/admin/ui/product-list";
import {
  getProductDisplayName,
  type Product,
} from "@/features/catalog/domain/product";
import { assignableCategories } from "@/features/catalog/infrastructure/category-repository";
import { formatIls } from "@/shared/lib/format-currency";
import { normalizeArabicText } from "@/shared/lib/normalize-arabic";

export const metadata: Metadata = {
  title: "المنتجات",
};

const tabs = [
  ["all", "الكل"],
  ["published", "منشور"],
  ["draft", "مسودة"],
  ["hidden", "مخفي"],
  ["unavailable", "غير متاح"],
  ["attention", "يحتاج متابعة"],
  ["archived", "مؤرشف"],
] as const;
type Tab = (typeof tabs)[number][0];

function priceLabel(product: Product): string {
  const prices = product.variants.length
    ? product.variants.map((variant) => variant.priceAgorot)
    : [product.priceAgorot];
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  return min === max ? formatIls(min) : `${formatIls(min)} – ${formatIls(max)}`;
}

// Name, Latin name, link id, variant labels, SKUs and barcodes, all Arabic-normalized.
function matches(product: Product, query: string): boolean {
  if (!query) return true;
  const haystack = normalizeArabicText(
    [
      product.nameAr,
      product.latinName ?? "",
      product.id,
      ...product.variants.flatMap((variant) => [
        variant.labelAr,
        variant.sku ?? "",
        variant.barcode ?? "",
      ]),
    ].join(" "),
  );
  return haystack.includes(normalizeArabicText(query));
}

export default async function AdminProductsPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    category?: string;
    status?: string;
    availability?: string;
    deleted?: string;
  }>;
}) {
  await connection();
  const actor = await requireAdminSession();
  const params = await searchParams;
  // Older «?availability=unavailable» links (alerts, bookmarks) keep working.
  const requested =
    params.status ??
    (params.availability === "unavailable" ? "unavailable" : "all");
  const tab: Tab = tabs.some(([id]) => id === requested)
    ? (requested as Tab)
    : "all";
  const canManage = can(actor, "settings.manage");

  const [products, archived, categories, stock, incomplete] = await Promise.all(
    [
      adminCatalogService.list(actor),
      adminCatalogService.listArchived(actor),
      assignableCategories(),
      can(actor, "stock.view")
        ? inventoryService.listStock(actor, { filter: "attention" })
        : [],
      catalogAuthoringService.incompleteDomainIds(),
    ],
  );
  const stockState = new Map<string, "out" | "low">();
  for (const item of stock) {
    if (item.status === "out") stockState.set(item.productId, "out");
    else if (item.status === "low" && !stockState.has(item.productId)) {
      stockState.set(item.productId, "low");
    }
  }
  const categoryName = (code: string) =>
    categories.find((entry) => entry.code === code)?.nameAr ?? code;
  const query = params.q?.trim() ?? "";
  const category = categories.some((entry) => entry.code === params.category)
    ? params.category
    : undefined;

  const rows: ProductListRow[] = products.map((product) => {
    const flags: ProductListRow["flags"] = [];
    if (incomplete.has(product.id)) {
      flags.push({
        id: "incomplete",
        label: "خيارات غير مكتملة",
        tone: "danger",
      });
    }
    if (product.image.kind === "placeholder") {
      flags.push({ id: "no_image", label: "بدون صورة", tone: "warning" });
    }
    const stockFlag = stockState.get(product.id);
    if (stockFlag === "out") {
      flags.push({ id: "out", label: "نفد المخزون", tone: "danger" });
    } else if (stockFlag === "low") {
      flags.push({ id: "low", label: "مخزون منخفض", tone: "warning" });
    }
    return {
      id: product.id,
      name: getProductDisplayName(product),
      category: categoryName(product.categoryId),
      price: priceLabel(product),
      variantCount: product.variants.length || 1,
      publication: product.publication,
      available: product.availability === "available",
      flags,
    };
  });

  const counts: Record<Tab, number> = {
    all: rows.length,
    published: rows.filter((row) => row.publication === "published").length,
    draft: rows.filter((row) => row.publication === "draft").length,
    hidden: rows.filter((row) => row.publication === "hidden").length,
    unavailable: rows.filter((row) => !row.available).length,
    attention: rows.filter((row) => row.flags.length).length,
    archived: archived.length,
  };
  const inTab = (row: ProductListRow) =>
    tab === "all" ||
    (tab === "unavailable" && !row.available) ||
    (tab === "attention" && row.flags.length > 0) ||
    row.publication === tab;
  const byId = new Map(products.map((product) => [product.id, product]));
  const visible = rows.filter((row) => {
    const product = byId.get(row.id)!;
    return (
      inTab(row) &&
      (!category || product.categoryId === category) &&
      matches(product, query)
    );
  });
  const archivedVisible = archived
    .filter(
      (product) =>
        (!category || product.categoryId === category) &&
        matches(product, query),
    )
    .map((product) => ({
      id: product.id,
      name: getProductDisplayName(product),
      category: categoryName(product.categoryId),
    }));
  const shown = tab === "archived" ? archivedVisible.length : visible.length;
  const filtered = Boolean(query || category);
  const hrefFor = (next: Tab, keepSearch = true) => {
    const search = new URLSearchParams();
    if (next !== "all") search.set("status", next);
    if (keepSearch && query) search.set("q", query);
    if (keepSearch && category) search.set("category", category);
    const value = search.toString();
    return value ? `/admin/products?${value}` : "/admin/products";
  };

  return (
    <main className="admin-page admin-products">
      <PageHeader
        title="المنتجات"
        lede={`${shown} ${tab === "archived" ? "منتج مؤرشف" : "منتج معروض"}`}
        actions={
          <Link
            className="admin-btn admin-btn-primary"
            href="/admin/products/new"
            prefetch={false}
          >
            <Plus size={18} aria-hidden="true" />
            إضافة منتج
          </Link>
        }
      />

      {params.deleted ? (
        <p className="admin-media-message" data-tone="ok" role="status">
          تم حذف «<bdi>{params.deleted.slice(0, 120)}</bdi>» نهائياً.
        </p>
      ) : null}

      <nav className="admin-status-tabs" aria-label="حالة المنتجات">
        {tabs.map(([id, label]) => (
          <Link
            key={id}
            href={hrefFor(id)}
            prefetch={false}
            aria-current={tab === id ? "page" : undefined}
          >
            {label}
            <span className="admin-num">{counts[id]}</span>
          </Link>
        ))}
      </nav>

      <form className="admin-toolbar" method="get" role="search">
        {tab !== "all" ? (
          <input type="hidden" name="status" value={tab} />
        ) : null}
        <div className="admin-toolbar-search">
          <label className="sr-only" htmlFor="product-search">
            بحث في المنتجات
          </label>
          <input
            id="product-search"
            name="q"
            type="search"
            dir="auto"
            defaultValue={query}
            placeholder="الاسم أو SKU أو الباركود"
          />
        </div>
        <label className="admin-toolbar-field" htmlFor="product-category">
          <span>القسم</span>
          <select
            id="product-category"
            name="category"
            defaultValue={category ?? ""}
          >
            <option value="">كل الأقسام</option>
            {categories.map((entry) => (
              <option key={entry.code} value={entry.code}>
                {entry.nameAr}
              </option>
            ))}
          </select>
        </label>
        <div className="admin-toolbar-actions">
          <button type="submit" className="admin-btn admin-btn-secondary">
            تطبيق
          </button>
          {filtered ? (
            <Link
              href={hrefFor(tab, false)}
              className="admin-btn admin-btn-ghost"
              prefetch={false}
            >
              مسح البحث
            </Link>
          ) : null}
        </div>
      </form>

      {shown === 0 ? (
        tab === "archived" ? (
          <EmptyState Icon={Archive} title="لا توجد منتجات مؤرشفة مطابقة">
            <p className="admin-muted">
              المنتجات المؤرشفة تظهر هنا ويمكن استعادتها.
            </p>
          </EmptyState>
        ) : (
          <EmptyState Icon={PackageSearch} title="لا توجد منتجات مطابقة">
            <p className="admin-muted">
              {filtered
                ? "غيّري البحث أو القسم، أو امسحي البحث."
                : "لا توجد منتجات بهذه الحالة الآن."}
            </p>
            <Link href="/admin/products/new" prefetch={false}>
              إضافة منتج
            </Link>
          </EmptyState>
        )
      ) : tab === "archived" ? (
        <ArchivedProductList rows={archivedVisible} canManage={canManage} />
      ) : (
        <ProductList rows={visible} canManage={canManage} />
      )}
    </main>
  );
}
