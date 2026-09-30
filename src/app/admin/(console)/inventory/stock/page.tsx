import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Package, PackageSearch, Search } from "lucide-react";
import { connection } from "next/server";

import { inventoryService } from "@/features/admin/application/admin-services";
import { requireAdminSession } from "@/features/admin/auth/admin-session";
import { can } from "@/features/admin/domain/permissions";
import { formatAdminDateTime } from "@/features/admin/ui/format-admin-datetime";
import {
  EmptyState,
  Money,
  PageHeader,
  Quantity,
  StockStatusPill,
} from "@/features/admin/ui/kit";
import type {
  StockListFilter,
  StockListItem,
} from "@/features/inventory/application/inventory-service";
import { stockMovementReasonLabels } from "@/features/inventory/domain/stock-constants";
import { formatBasisPoints } from "@/shared/lib/money-math";

export const metadata: Metadata = { title: "قائمة المخزون" };

const filters: { id: StockListFilter; label: string }[] = [
  { id: "all", label: "الكل" },
  { id: "attention", label: "النواقص" },
  { id: "tracked", label: "متتبَّع" },
  { id: "untracked", label: "غير متتبَّع" },
];

function Thumb({ item }: { item: StockListItem }) {
  return item.imageSrc ? (
    <Image
      className="admin-thumb"
      src={item.imageSrc}
      alt=""
      width={44}
      height={44}
    />
  ) : (
    <span className="admin-thumb admin-thumb--empty" aria-hidden="true">
      <Package size={20} />
    </span>
  );
}

function LastMovement({ item }: { item: StockListItem }) {
  if (!item.lastMovementAt || !item.lastMovementReason) return <>—</>;
  return (
    <>
      {stockMovementReasonLabels[item.lastMovementReason]} ·{" "}
      {formatAdminDateTime(item.lastMovementAt)}
    </>
  );
}

export default async function StockListPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; q?: string }>;
}) {
  await connection();
  const actor = await requireAdminSession();
  const params = await searchParams;
  const filter = filters.find((item) => item.id === params.filter)?.id ?? "all";
  const search = (params.q ?? "").slice(0, 80);
  const items = await inventoryService.listStock(actor, { filter, search });
  const showCosts = can(actor, "stock.costs");

  return (
    <main className="admin-page">
      <PageHeader
        title="قائمة المخزون"
        back={{ href: "/admin/inventory", label: "المخزون والمشتريات" }}
      />

      <form className="admin-search-bar" action="/admin/inventory/stock">
        <input type="hidden" name="filter" value={filter} />
        <label className="sr-only" htmlFor="stock-search">
          بحث في المخزون
        </label>
        <Search size={18} aria-hidden="true" />
        <input
          id="stock-search"
          name="q"
          type="search"
          defaultValue={search}
          placeholder="اسم المنتج أو الباركود"
        />
        <button type="submit" className="admin-btn admin-btn-secondary">
          بحث
        </button>
      </form>

      <nav className="admin-tabs" aria-label="تصفية المخزون">
        {filters.map((item) => (
          <Link
            key={item.id}
            href={`/admin/inventory/stock?filter=${item.id}${search ? `&q=${encodeURIComponent(search)}` : ""}`}
            prefetch={false}
            className={item.id === filter ? "admin-tab is-active" : "admin-tab"}
            aria-current={item.id === filter ? "page" : undefined}
          >
            {item.label}
          </Link>
        ))}
      </nav>

      {items.length === 0 ? (
        <EmptyState Icon={PackageSearch} title="لا توجد أصناف مطابقة">
          <p className="admin-muted">جرّبي تصفية أخرى أو امسحي البحث.</p>
        </EmptyState>
      ) : (
        <>
          <ul className="admin-stock-rows" aria-label="أصناف المخزون">
            {items.map((item) => (
              <li key={item.variantId}>
                <Link
                  href={`/admin/inventory/stock/${item.variantId}`}
                  prefetch={false}
                  className="admin-stock-row"
                >
                  <Thumb item={item} />
                  <span className="admin-stock-row-body">
                    <span className="admin-stock-row-title">
                      <strong>{item.name}</strong>
                      <StockStatusPill status={item.status} />
                    </span>
                    {item.variantLabel ? (
                      <small>{item.variantLabel}</small>
                    ) : null}
                    {item.tracked ? (
                      <span className="admin-stock-row-figures">
                        <span>
                          المتوفر{" "}
                          <Quantity
                            milli={item.availableMilli}
                            unit={item.unit}
                          />
                        </span>
                        {item.reservedMilli > 0 ? (
                          <span>
                            محجوز <Quantity milli={item.reservedMilli} />
                          </span>
                        ) : null}
                        <span>
                          البيع <Money agorot={item.salePriceAgorot} />
                        </span>
                        {showCosts && item.avgCostAgorot !== null ? (
                          <span>
                            التكلفة <Money agorot={item.avgCostAgorot} />
                          </span>
                        ) : null}
                      </span>
                    ) : (
                      <span className="admin-stock-row-figures">
                        <span>
                          البيع <Money agorot={item.salePriceAgorot} />
                        </span>
                      </span>
                    )}
                  </span>
                </Link>
              </li>
            ))}
          </ul>

          <div className="admin-table-wrap admin-stock-table">
            <table className="admin-data-table">
              <thead>
                <tr>
                  <th>المنتج</th>
                  <th>الحالة</th>
                  <th>الكمية</th>
                  <th>محجوز</th>
                  <th>المتوفر</th>
                  {showCosts ? <th>متوسط التكلفة</th> : null}
                  <th>سعر البيع</th>
                  {showCosts ? <th>هامش تقديري للوحدة</th> : null}
                  <th>آخر حركة</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.variantId}>
                    <td>
                      <Link
                        href={`/admin/inventory/stock/${item.variantId}`}
                        prefetch={false}
                        className="admin-table-product"
                      >
                        <Thumb item={item} />
                        <span>
                          {item.name}
                          {item.variantLabel ? (
                            <small>{item.variantLabel}</small>
                          ) : null}
                        </span>
                      </Link>
                    </td>
                    <td>
                      <StockStatusPill status={item.status} />
                    </td>
                    <td>
                      {item.tracked ? (
                        <Quantity milli={item.onHandMilli} unit={item.unit} />
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>
                      {item.tracked ? (
                        <Quantity milli={item.reservedMilli} />
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>
                      {item.tracked ? (
                        <Quantity milli={item.availableMilli} />
                      ) : (
                        "—"
                      )}
                    </td>
                    {showCosts ? (
                      <td>
                        {item.avgCostAgorot === null ? (
                          "—"
                        ) : (
                          <Money agorot={item.avgCostAgorot} />
                        )}
                      </td>
                    ) : null}
                    <td>
                      <Money agorot={item.salePriceAgorot} />
                    </td>
                    {showCosts ? (
                      <td>
                        {item.unitProfitAgorot === null ? (
                          "—"
                        ) : (
                          <>
                            <Money agorot={item.unitProfitAgorot} />
                            {item.marginBasisPoints === null ? null : (
                              <small className="admin-muted">
                                {" "}
                                <bdi dir="ltr">
                                  {formatBasisPoints(item.marginBasisPoints)}
                                </bdi>
                              </small>
                            )}
                          </>
                        )}
                      </td>
                    ) : null}
                    <td className="admin-muted">
                      <LastMovement item={item} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </main>
  );
}
