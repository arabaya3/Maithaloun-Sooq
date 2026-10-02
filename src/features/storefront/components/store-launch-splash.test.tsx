import { readFileSync } from "node:fs";
import { join } from "node:path";

import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import OfflinePage from "@/app/(store)/~offline/page";

import { LAUNCH_SESSION_KEY, StoreLaunchSplash } from "./store-launch-splash";

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
  it("shows the official logo and brand name, with decoration hidden from screen readers", () => {
    const { container } = render(<StoreLaunchSplash />);
    const brand = container.querySelector(".launch-splash-brand");
    expect(brand).toHaveAttribute("aria-hidden", "true");
    expect(brand).toHaveTextContent("سوق ميثلون");
    expect(brand).toHaveTextContent("منظفات ومعطرات جو");
    const logo = container.querySelector(".launch-splash-logo");
    expect(decodeURIComponent(logo?.getAttribute("src") ?? "")).toContain(
      "/brand/maithaloun-symbol.png",
    );
    expect(screen.getByRole("status")).toHaveTextContent("جارٍ فتح سوق ميثلون");
    expect(container.querySelector("button, a, input, [tabindex]")).toBeNull();
    expect(container.innerHTML).not.toContain("/icons/icon-");
  });

  it("marks the app ready once it hydrates, so the splash exits", () => {
    render(<StoreLaunchSplash />);
    expect(document.documentElement.dataset.launch).toBe("ready");
    expect(rule('html[data-launch="ready"] .launch-splash')).toContain(
      "visibility: hidden",
    );
  });

  it("keeps a skipped launch skipped for reloads and navigations in the session", () => {
    document.documentElement.dataset.launch = "skip";
    render(<StoreLaunchSplash />);
    expect(document.documentElement.dataset.launch).toBe("skip");
    expect(rule('html[data-launch="skip"] .launch-splash')).toContain(
      "display: none",
    );
  });

  it("runs the pre-paint session check against sessionStorage only", () => {
    const { container } = render(<StoreLaunchSplash />);
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
        "@media (prefers-reduced-motion: reduce) {\n  .launch-splash-mark",
      ),
    );
    expect(reduced).toContain("animation: launch-fade 200ms ease-out both;");
    expect(reduced).toMatch(
      /\.launch-splash-shine,\s+\.launch-splash-bubble \{\s+display: none;/,
    );
  });
});

describe("offline page", () => {
  it("uses the official logo", () => {
    render(<OfflinePage />);
    const logo = screen.getByAltText("سوق ميثلون");
    expect(decodeURIComponent(logo.getAttribute("src") ?? "")).toContain(
      "/brand/maithaloun-symbol.png",
    );
  });
});
