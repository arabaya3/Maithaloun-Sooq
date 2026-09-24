export function isTrustedMutationOrigin(
  originHeader: string | null,
  appOrigin: string,
): boolean {
  if (!originHeader) return false;
  try {
    const requestOrigin = new URL(originHeader).origin;
    const configuredOrigin = new URL(appOrigin).origin;
    return requestOrigin === configuredOrigin;
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
