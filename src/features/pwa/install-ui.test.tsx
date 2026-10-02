import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { dismissalStorageKey } from "./install-state";

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

function dispatchInstallPrompt(outcome: "accepted" | "dismissed") {
  const event = new Event("beforeinstallprompt", { cancelable: true });
  const prompt = vi.fn().mockResolvedValue(undefined);
  Object.assign(event, { prompt, userChoice: Promise.resolve({ outcome }) });
  act(() => {
    window.dispatchEvent(event);
  });
  return { event, prompt };
}

async function loadBanner() {
  vi.resetModules();
  const banner = await import("./storefront-install-banner");
  return banner.StorefrontInstallBanner;
}

async function loadAdminAction() {
  vi.resetModules();
  const action = await import("./admin-install-action");
  return action.AdminInstallAction;
}

function setUserAgent(value: string) {
  Object.defineProperty(window.navigator, "userAgent", {
    value,
    configurable: true,
  });
}

beforeEach(() => {
  setUserAgent("Mozilla/5.0 (Linux; Android 14) Chrome/130 Mobile");
});

describe("storefront install banner", () => {
  it("stays hidden until the browser offers installation", async () => {
    const Banner = await loadBanner();
    render(<Banner />);
    expect(
      screen.queryByRole("button", { name: "تثبيت التطبيق" }),
    ).not.toBeInTheDocument();
  });

  it("defers the browser prompt and triggers it from the banner", async () => {
    const Banner = await loadBanner();
    render(<Banner />);
    const { event, prompt } = dispatchInstallPrompt("accepted");
    expect(event.defaultPrevented).toBe(true);

    await userEvent.click(
      screen.getByRole("button", { name: "تثبيت التطبيق" }),
    );
    expect(prompt).toHaveBeenCalledOnce();
    expect(
      screen.queryByRole("button", { name: "تثبيت التطبيق" }),
    ).not.toBeInTheDocument();
  });

  it("shows the official logo and says installing is optional", async () => {
    const Banner = await loadBanner();
    const { container } = render(<Banner />);
    dispatchInstallPrompt("dismissed");
    const logo = container.querySelector(".install-banner-logo");
    expect(decodeURIComponent(logo?.getAttribute("src") ?? "")).toContain(
      "/brand/maithaloun-symbol.png",
    );
    expect(screen.getByText("ثبّت سوق ميثلون")).toBeVisible();
    expect(screen.getByText(/التثبيت اختياري/)).toBeVisible();
  });

  it("persists a dismissal with an expiry", async () => {
    const Banner = await loadBanner();
    render(<Banner />);
    dispatchInstallPrompt("dismissed");
    await userEvent.click(screen.getByRole("button", { name: "لاحقاً" }));

    expect(
      screen.queryByRole("button", { name: "تثبيت التطبيق" }),
    ).not.toBeInTheDocument();
    const stored = Number(
      window.localStorage.getItem(dismissalStorageKey("storefront")),
    );
    expect(stored).toBeGreaterThan(Date.now());
  });

  it("hides after the app is installed", async () => {
    const Banner = await loadBanner();
    render(<Banner />);
    dispatchInstallPrompt("accepted");
    act(() => {
      window.dispatchEvent(new Event("appinstalled"));
    });
    expect(
      screen.queryByRole("button", { name: "تثبيت التطبيق" }),
    ).not.toBeInTheDocument();
  });

  it("shows manual steps on iOS instead of a programmatic prompt", async () => {
    setUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)");
    const Banner = await loadBanner();
    render(<Banner />);
    await userEvent.click(
      screen.getByRole("button", { name: "تثبيت التطبيق" }),
    );
    expect(screen.getByText("افتح زر المشاركة في المتصفح.")).toBeVisible();
  });
});

describe("admin install action", () => {
  it("explains the iPhone steps in Arabic", async () => {
    setUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)");
    const Action = await loadAdminAction();
    render(<Action />);
    await userEvent.click(
      screen.getByRole("button", { name: /ثبّتي تطبيق الإدارة على الجهاز/ }),
    );
    expect(screen.getByText("افتحي زر المشاركة.")).toBeVisible();
    expect(
      screen.getByText("اختاري “إضافة إلى الشاشة الرئيسية”."),
    ).toBeVisible();
    expect(screen.getByText("اضغطي “إضافة”.")).toBeVisible();
  });

  it("disappears once the app runs standalone", async () => {
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: query.includes("standalone"),
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    })) as unknown as typeof window.matchMedia;
    try {
      const Action = await loadAdminAction();
      render(<Action />);
      expect(
        screen.queryByRole("button", {
          name: /ثبّتي تطبيق الإدارة على الجهاز/,
        }),
      ).not.toBeInTheDocument();
    } finally {
      window.matchMedia = original;
    }
  });
});
