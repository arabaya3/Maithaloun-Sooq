import { describe, expect, it } from "vitest";

import { adminManifest } from "./admin-manifest";
import { storefrontManifest } from "./storefront-manifest";

describe("web app manifest", () => {
  it("uses the official Arabic identity and RTL direction", () => {
    const value = storefrontManifest;

    expect(value.name).toBe("سوق ميثلون");
    expect(value.short_name).toBe("سوق ميثلون");
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
    expect(purposes).toEqual(
      expect.arrayContaining([
        "192x192:any",
        "512x512:any",
        "512x512:maskable",
      ]),
    );
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
