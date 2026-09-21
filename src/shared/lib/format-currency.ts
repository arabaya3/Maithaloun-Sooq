const numberFormatter = new Intl.NumberFormat("ar-PS-u-nu-latn", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

export function formatIls(agorot: number): string {
  return `${numberFormatter.format(agorot / 100)} ₪`;
}
