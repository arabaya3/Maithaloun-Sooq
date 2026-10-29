"use client";

import { useEffect } from "react";

const CODE = /^mc-[0-9a-f]{12}$/;

/**
 * Counts a landing from a tracked campaign link once per browser session. It sends only the
 * campaign code from the address, to the store itself; no third-party script is involved.
 */
export function CampaignLanding() {
  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get(
      "utm_campaign",
    );
    // Automated browsers (tests, crawlers) are not visitors.
    if (!code || !CODE.test(code) || navigator.webdriver) return;
    const key = `maytha-campaign-seen:${code}`;
    try {
      if (window.sessionStorage.getItem(key)) return;
      window.sessionStorage.setItem(key, "1");
    } catch {
      // Without session storage a landing may count twice in one session; it is still one visit per load.
    }
    void fetch("/api/v1/campaign-visits", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
      keepalive: true,
    }).catch(() => undefined);
  }, []);
  return null;
}
