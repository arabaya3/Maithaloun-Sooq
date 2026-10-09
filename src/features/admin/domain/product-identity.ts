const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** A URL-safe id from the Latin name when it has one, with a short suffix so two products never clash. */
export function newProductId(latinName: string, suffix: string): string {
  const base = latinName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
  const tail = suffix
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 8);
  const id = `${SLUG.test(base) ? base : "product"}-${tail}`;
  return SLUG.test(id) ? id : `product-${tail || "new"}`;
}
