const PRODUCTION_VERCEL_ALIASES = new Set([
  "https://maithaloun-sooq.vercel.app",
  "https://maitloun-sooq.vercel.app",
]);

export function isTrustedMutationOrigin(
  originHeader: string | null,
  appOrigin: string,
): boolean {
  if (!originHeader) return false;
  try {
    const requestOrigin = new URL(originHeader).origin;
    const configuredOrigin = new URL(appOrigin).origin;
    if (requestOrigin === configuredOrigin) return true;

    // Both project aliases are public production hosts; accept either interchangeably.
    return (
      PRODUCTION_VERCEL_ALIASES.has(configuredOrigin) &&
      PRODUCTION_VERCEL_ALIASES.has(requestOrigin)
    );
  } catch {
    return false;
  }
}

export function isTrustedMutationSite(secFetchSite: string | null): boolean {
  return (
    secFetchSite === null ||
    secFetchSite === "same-origin" ||
    secFetchSite === "none"
  );
}
