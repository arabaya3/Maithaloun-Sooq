const numberFormatter = new Intl.NumberFormat("ar-PS", {
  maximumFractionDigits: 0,
});

export function formatIls(value: number): string {
  return `${numberFormatter.format(value)} ₪`;
}
