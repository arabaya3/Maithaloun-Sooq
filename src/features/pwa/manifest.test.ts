import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { metadata } from "@/app/layout";

import { appIcons } from "./app-icons";

import { adminManifest } from "./admin-manifest";
import { storefrontManifest } from "./storefront-manifest";

describe("web app manifest", () => {
  it("uses the official Arabic identity and RTL direction", () => {
    const value = storefrontManifest;

    expect(value.name).toBe("سوق ميثلون");
    expect(value.short_name).toBe("ميثلون");
    expect(value.lang).toBe("ar");
    expect(value.dir).toBe("rtl");
  });

  it("is installable as a standalone storefront app", () => {
    const value = storefrontManifest;

    expect(value.start_url).toBe("/");
    expect(value.scope).toBe("/");
    expect(value.display).toBe("standalone");
    const purposes = value.icons?.map(
      (icon) => `${icon.sizes}:${icon.purpose}`,
    );
    expect(purposes).toEqual([
      "192x192:any",
      "512x512:any",
      "192x192:maskable",
      "512x512:maskable",
    ]);
  });

  it("serves every icon at its declared size from the official logo set", async () => {
    const declared = [
      ...(storefrontManifest.icons ?? []).map((icon) => ({
        src: icon.src,
        size: Number(icon.sizes?.split("x")[0]),
      })),
      { src: appIcons.favicon16, size: 16 },
      { src: appIcons.favicon32, size: 32 },
      { src: appIcons.appleTouch, size: 180 },
    ];
    for (const { src, size } of declared) {
      expect(src).toMatch(/^\/brand\/app\/.+-v2\.png$/);
      const file = join(process.cwd(), "public", src);
      expect(existsSync(file)).toBe(true);
      const info = await sharp(file).metadata();
      expect([info.width, info.height]).toEqual([size, size]);
    }
  });

  it("drops the old placeholder icon from manifests and metadata", () => {
    const text = JSON.stringify([storefrontManifest, adminManifest, metadata]);
    expect(text).not.toContain("/icons/icon-");
    expect(existsSync(join(process.cwd(), "public/icons"))).toBe(false);
    expect(adminManifest.icons).toEqual(storefrontManifest.icons);
    expect(
      readFileSync(join(process.cwd(), "src/app/sw.ts"), "utf8"),
    ).not.toContain("/icons/");
  });

  it("links the new favicon and Apple touch icon in browser metadata", () => {
    expect(JSON.stringify(metadata.icons)).toContain(appIcons.favicon32);
    expect(JSON.stringify(metadata.icons)).toContain(appIcons.favicon16);
    expect(JSON.stringify(metadata.icons)).toContain(appIcons.appleTouch);
  });
});

describe("admin web app manifest", () => {
  it("opens directly into the admin workflow", () => {
    expect(adminManifest.start_url).toBe("/admin");
    expect(adminManifest.scope).toBe("/admin");
    expect(adminManifest.display).toBe("standalone");
    expect(adminManifest.id).not.toBe(storefrontManifest.id);
    expect(adminManifest.dir).toBe("rtl");
  });
});
