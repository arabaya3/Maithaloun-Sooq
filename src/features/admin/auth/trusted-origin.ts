export function isTrustedMutationOrigin(
  originHeader: string | null,
  appOrigin: string,
): boolean {
  if (!originHeader) return false;
  try {
    return new URL(originHeader).origin === new URL(appOrigin).origin;
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
