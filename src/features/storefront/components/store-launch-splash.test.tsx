import { readFileSync } from "node:fs";
import { join } from "node:path";

import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { messagesFor } from "@/i18n/messages";
import OfflinePage from "@/app/(store)/~offline/page";

import { LAUNCH_SESSION_KEY, StoreLaunchSplash } from "./store-launch-splash";

vi.mock("@/i18n/server", () => ({
  getLocale: async () => "ar",
  getMessages: async () => messagesFor("ar"),
}));

const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

function rule(selector: string) {
  const start = css.indexOf(`${selector} {`);
  return css.slice(start, css.indexOf("}", start));
}

afterEach(() => {
  delete document.documentElement.dataset.launch;
  sessionStorage.clear();
});

describe("StoreLaunchSplash", () => {
  it("shows the MAYTHA wordmark, with decoration hidden from screen readers", async () => {
    const { container } = render(await StoreLaunchSplash());
    const brand = container.querySelector(".launch-splash-brand");
    expect(brand).toHaveAttribute("aria-hidden", "true");
    expect(brand?.querySelector(".brand-name")).toHaveTextContent("MAYTHA");
    expect(brand?.querySelector(".brand-subtitle")).toHaveTextContent(
      "HOME & CARE",
    );
    expect(screen.getByRole("status")).toHaveTextContent("جارٍ فتح MAYTHA");
    expect(container.querySelector("button, a, input, [tabindex]")).toBeNull();
    expect(container.innerHTML).not.toContain("/icons/icon-");
  });

  it("marks the app ready once it hydrates, so the splash exits", async () => {
    render(await StoreLaunchSplash());
    expect(document.documentElement.dataset.launch).toBe("ready");
    expect(rule('html[data-launch="ready"] .launch-splash')).toContain(
      "visibility: hidden",
    );
  });

  it("keeps a skipped launch skipped for reloads and navigations in the session", async () => {
    document.documentElement.dataset.launch = "skip";
    render(await StoreLaunchSplash());
    expect(document.documentElement.dataset.launch).toBe("skip");
    expect(rule('html[data-launch="skip"] .launch-splash')).toContain(
      "display: none",
    );
  });

  it("runs the pre-paint session check against sessionStorage only", async () => {
    const { container } = render(await StoreLaunchSplash());
    const script = container.querySelector("script")?.textContent ?? "";
    expect(script).toContain(LAUNCH_SESSION_KEY);
    expect(script).toContain("sessionStorage");
    expect(script).toContain("catch");
  });

  it("can never cover the app indefinitely, even without JavaScript", () => {
    expect(rule(".launch-splash")).toMatch(
      /animation: launch-splash-out \d+ms ease-in \d+ms forwards/,
    );
    expect(css).toMatch(
      /@keyframes launch-splash-out \{\s+to \{\s+opacity: 0;\s+visibility: hidden;/,
    );
  });

  it("drops the motion to a short fade for reduced-motion users", () => {
    const reduced = css.slice(
      css.indexOf(
        "@media (prefers-reduced-motion: reduce) {\n  .launch-splash-brand .brand-name",
      ),
    );
    expect(reduced).toMatch(
      /\.launch-splash-rule \{\s+animation: launch-fade 200ms ease-out both;/,
    );
  });
});

describe("offline page", () => {
  it("uses the MAYTHA app icon", async () => {
    render(await OfflinePage());
    const logo = screen.getByAltText("MAYTHA");
    expect(decodeURIComponent(logo.getAttribute("src") ?? "")).toContain(
      "/brand/app/icon-192-v4.png",
    );
  });
});
