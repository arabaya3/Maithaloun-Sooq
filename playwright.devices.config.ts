import { defineConfig, devices } from "@playwright/test";

import base from "./playwright.config";

// Developer tooling on top of the main config, which stays the gate: the same specs on desktop, and
// screenshot comparisons on phone and desktop. Same local server and test database.
const phone = { ...devices["Pixel 5"], viewport: { width: 390, height: 844 } };
const desktop = {
  ...devices["Desktop Chrome"],
  viewport: { width: 1440, height: 900 },
};

export default defineConfig({
  ...base,
  snapshotPathTemplate:
    "{testDir}/__screenshots__/{projectName}/{platform}/{arg}{ext}",
  expect: {
    ...base.expect,
    toHaveScreenshot: { maxDiffPixelRatio: 0.01, animations: "disabled" },
  },
  projects: [
    { name: "mobile-chromium", use: phone },
    { name: "desktop-chromium", use: desktop },
    { name: "visual-mobile", testDir: "./tests/visual", use: phone },
    { name: "visual-desktop", testDir: "./tests/visual", use: desktop },
  ],
});
