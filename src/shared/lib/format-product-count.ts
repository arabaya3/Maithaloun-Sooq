const pluralRules = new Intl.PluralRules("ar-PS");

export function formatProductCount(count: number): string {
  const form = pluralRules.select(count);

  if (form === "zero") return "لا منتجات";
  if (form === "one") return "منتج واحد";
  if (form === "two") return "منتجان";
  if (form === "few") return `${count} منتجات`;
  return `${count} منتجًا`;
}
