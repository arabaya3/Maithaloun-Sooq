import type { ProductSpecification } from "@/features/catalog/domain/product-variant";

export function ProductSpecifications({
  specifications,
}: {
  specifications: readonly ProductSpecification[];
}) {
  const rows = [...specifications]
    .filter((spec) => spec.labelAr.trim() && spec.valueAr.trim())
    .sort((left, right) => left.sortOrder - right.sortOrder);

  if (!rows.length) return null;

  return (
    <section className="product-specs" aria-labelledby="product-specs-title">
      <h2 id="product-specs-title">تفاصيل المنتج</h2>
      <dl className="product-specs-list">
        {rows.map((spec) => (
          <div className="product-specs-row" key={spec.id}>
            <dt>{spec.labelAr}</dt>
            <dd>{spec.valueAr}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
