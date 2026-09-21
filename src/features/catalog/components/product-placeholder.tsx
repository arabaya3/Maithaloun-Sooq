import type { PlaceholderKind } from "@/features/catalog/domain/product";

export function ProductPlaceholder({ kind }: { kind: PlaceholderKind }) {
  return (
    <div
      className="product-placeholder"
      data-placeholder-kind={kind}
      aria-hidden="true"
    >
      <span className="placeholder-object">
        <span className="placeholder-cap" />
        <span className="placeholder-trigger" />
        <span className="placeholder-handle" />
        <span className="placeholder-body">
          <span className="placeholder-label" />
        </span>
        <span className="placeholder-bristles" />
      </span>
    </div>
  );
}
