export const INSTALL_DISMISS_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

export type InstallScope = "storefront" | "admin";
export type InstallStatus = "unsupported" | "available" | "ios" | "installed";

export function dismissalStorageKey(scope: InstallScope): string {
  return `souq:install-dismissed-until:${scope}`;
}

export function nextDismissalExpiry(now: number): string {
  return String(now + INSTALL_DISMISS_DAYS * DAY_MS);
}

export function isDismissalActive(raw: string | null, now: number): boolean {
  if (!raw) return false;
  const until = Number(raw);
  return Number.isFinite(until) && until > now;
}

export function isIosDevice(input: {
  userAgent: string;
  platform?: string;
  maxTouchPoints?: number;
}): boolean {
  if (/iPad|iPhone|iPod/.test(input.userAgent)) return true;
  // iPadOS reports a desktop Mac user agent.
  return input.platform === "MacIntel" && (input.maxTouchPoints ?? 0) > 1;
}

export function resolveInstallStatus(input: {
  standalone: boolean;
  installed: boolean;
  hasDeferredPrompt: boolean;
  ios: boolean;
}): InstallStatus {
  if (input.standalone || input.installed) return "installed";
  if (input.hasDeferredPrompt) return "available";
  if (input.ios) return "ios";
  return "unsupported";
}
