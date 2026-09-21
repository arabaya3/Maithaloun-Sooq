export function normalizePalestinianPhone(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || !/^[+\d\s()-]+$/.test(trimmed)) return null;

  const compact = trimmed.replace(/[\s()-]/g, "");
  let localNumber: string;

  if (/^05[69]\d{7}$/.test(compact)) {
    localNumber = compact.slice(1);
  } else if (/^\+9705[69]\d{7}$/.test(compact)) {
    localNumber = compact.slice(4);
  } else if (/^009705[69]\d{7}$/.test(compact)) {
    localNumber = compact.slice(5);
  } else if (/^9705[69]\d{7}$/.test(compact)) {
    localNumber = compact.slice(3);
  } else {
    return null;
  }

  return `+970${localNumber}`;
}
