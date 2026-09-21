export function formatAdminDateTime(value: string | Date): string {
  return new Intl.DateTimeFormat("ar-PS-u-nu-latn", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(typeof value === "string" ? new Date(value) : value);
}
