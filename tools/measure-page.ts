// Usage: tsx tools/measure-page.ts <url> [runs=5]
// Fresh browser context per run; 390×844, 40 ms latency, ~10 Mbit/s down, 4× CPU slowdown. Prints medians as JSON.
import { chromium } from "@playwright/test";

type Sample = {
  ttfb: number;
  fcp: number;
  lcp: number;
  cls: number;
  tbt: number;
  jsBytes: number;
  imageBytes: number;
};

const [url, runsArg] = process.argv.slice(2);
if (!url) {
  console.error("Usage: tsx tools/measure-page.ts <url> [runs]");
  process.exit(1);
}
const runs = Number(runsArg ?? 5);

async function measure(): Promise<Sample> {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 3,
      isMobile: true,
      hasTouch: true,
    });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: 40,
      downloadThroughput: (10 * 1024 * 1024) / 8,
      uploadThroughput: (5 * 1024 * 1024) / 8,
    });
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    await page.addInitScript(() => {
      const state = { lcp: 0, cls: 0, tbt: 0 };
      (window as unknown as { __perf: typeof state }).__perf = state;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) state.lcp = entry.startTime;
      }).observe({ type: "largest-contentful-paint", buffered: true });
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as Array<
          PerformanceEntry & { value: number; hadRecentInput: boolean }
        >) {
          if (!entry.hadRecentInput) state.cls += entry.value;
        }
      }).observe({ type: "layout-shift", buffered: true });
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          state.tbt += Math.max(0, entry.duration - 50);
        }
      }).observe({ type: "longtask", buffered: true });
    });
    await page.goto(url!, { waitUntil: "networkidle" });
    await page.waitForTimeout(2_000);
    return await page.evaluate(() => {
      const nav = performance.getEntriesByType(
        "navigation",
      )[0] as PerformanceNavigationTiming;
      const resources = performance.getEntriesByType(
        "resource",
      ) as PerformanceResourceTiming[];
      const state = (
        window as unknown as {
          __perf: { lcp: number; cls: number; tbt: number };
        }
      ).__perf;
      // No named helpers here: tsx would wrap them in a __name() call that the page does not have.
      let jsBytes = 0;
      let imageBytes = 0;
      for (const entry of resources) {
        if (entry.name.includes(".js")) jsBytes += entry.transferSize;
        if (
          entry.initiatorType === "img" ||
          entry.name.includes("/_next/image")
        ) {
          imageBytes += entry.transferSize;
        }
      }
      return {
        ttfb: nav.responseStart,
        fcp:
          performance.getEntriesByName("first-contentful-paint")[0]
            ?.startTime ?? 0,
        lcp: state.lcp,
        cls: state.cls,
        tbt: state.tbt,
        jsBytes,
        imageBytes,
      };
    });
  } finally {
    await browser.close();
  }
}

const samples: Sample[] = [];
for (let index = 0; index < runs; index += 1) samples.push(await measure());
const median = (key: keyof Sample) => {
  const sorted = samples.map((row) => row[key]).sort((a, b) => a - b);
  return Math.round(sorted[Math.floor(sorted.length / 2)]! * 1000) / 1000;
};
console.log(
  JSON.stringify(
    Object.fromEntries(
      (Object.keys(samples[0]!) as Array<keyof Sample>).map((key) => [
        key,
        median(key),
      ]),
    ),
  ),
);
