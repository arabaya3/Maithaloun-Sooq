const ADMIN_PATH_PATTERN = /^\/admin(?:\/[A-Za-z0-9._~-]*)*$/;

export function getSafeAdminRedirect(
  target: string | null | undefined,
): string {
  if (!target) return "/admin";
  if (
    target.includes("\\") ||
    target.includes("://") ||
    target.startsWith("//")
  ) {
    return "/admin";
  }
  if (!target.startsWith("/admin")) return "/admin";
  if (target === "/admin/login" || target.startsWith("/admin/login?")) {
    return "/admin";
  }
  if (target.includes("?") || target.includes("#") || target.includes("%")) {
    const [pathname] = target.split(/[?#]/);
    if (!pathname || !ADMIN_PATH_PATTERN.test(pathname)) return "/admin";
    return pathname;
  }
  if (!ADMIN_PATH_PATTERN.test(target)) return "/admin";
  return target;
}

export function isSafeAdminRedirect(target: string): boolean {
  return getSafeAdminRedirect(target) === target;
}
