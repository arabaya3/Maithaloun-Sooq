const numberFormatter = new Intl.NumberFormat("ar-PS-u-nu-latn", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

export function formatIls(agorot: number): string {
  // Adding 0 turns -0 into +0 so a zero amount never renders as "-0 ₪".
  return `${numberFormatter.format(agorot / 100 + 0)} ₪`;
}
