import { describe, expect, it } from "vitest";

import {
  INSTALL_DISMISS_DAYS,
  isDismissalActive,
  isIosDevice,
  nextDismissalExpiry,
  resolveInstallStatus,
} from "./install-state";

describe("install state", () => {
  it("expires a dismissal after the configured period", () => {
    const now = 1_000_000;
    const stored = nextDismissalExpiry(now);
    expect(isDismissalActive(stored, now + 1)).toBe(true);
    expect(
      isDismissalActive(stored, now + INSTALL_DISMISS_DAYS * 86_400_000 + 1),
    ).toBe(false);
    expect(isDismissalActive(null, now)).toBe(false);
    expect(isDismissalActive("not-a-number", now)).toBe(false);
  });

  it("detects iPhone and iPadOS devices", () => {
    expect(
      isIosDevice({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)" }),
    ).toBe(true);
    expect(
      isIosDevice({
        userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
        platform: "MacIntel",
        maxTouchPoints: 5,
      }),
    ).toBe(true);
    expect(
      isIosDevice({
        userAgent: "Mozilla/5.0 (Linux; Android 14)",
        platform: "Linux armv8l",
        maxTouchPoints: 5,
      }),
    ).toBe(false);
  });

  it("prefers installed over any prompt", () => {
    const base = {
      standalone: false,
      installed: false,
      hasDeferredPrompt: false,
      ios: false,
    };
    expect(
      resolveInstallStatus({
        ...base,
        standalone: true,
        hasDeferredPrompt: true,
        ios: true,
      }),
    ).toBe("installed");
    expect(resolveInstallStatus({ ...base, hasDeferredPrompt: true })).toBe(
      "available",
    );
    expect(resolveInstallStatus({ ...base, ios: true })).toBe("ios");
    expect(resolveInstallStatus(base)).toBe("unsupported");
  });
});
