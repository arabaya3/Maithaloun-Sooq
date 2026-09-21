const USERNAME_PATTERN = /^[a-z0-9._-]{3,32}$/;

export function normalizeAdminUsername(value: string): string | null {
  const normalized = value.normalize("NFKC").trim().toLowerCase();
  if (!USERNAME_PATTERN.test(normalized)) return null;
  return normalized;
}

export function isNormalizedAdminUsername(value: string): boolean {
  return USERNAME_PATTERN.test(value);
}
