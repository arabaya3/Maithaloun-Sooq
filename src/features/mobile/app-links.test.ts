import { describe, expect, it } from "vitest";

import { androidAssetLinks, appleAppSiteAssociation } from "./app-links";

const fingerprint = Array.from({ length: 32 }, () => "AB").join(":");

describe("app link verification files", () => {
  it("stay absent until the owner provides real values", () => {
    expect(androidAssetLinks(undefined)).toBeNull();
    expect(androidAssetLinks("not-a-fingerprint")).toBeNull();
    expect(appleAppSiteAssociation(undefined)).toBeNull();
    expect(appleAppSiteAssociation("short")).toBeNull();
  });

  it("lists only valid certificate fingerprints for the app package", () => {
    const body = androidAssetLinks(`${fingerprint.toLowerCase()}, junk`);
    expect(body).toEqual([
      {
        relation: ["delegate_permission/common.handle_all_urls"],
        target: {
          namespace: "android_app",
          package_name: "market.maytha.app",
          sha256_cert_fingerprints: [fingerprint],
        },
      },
    ]);
  });

  it("links only product pages to the iOS app", () => {
    expect(appleAppSiteAssociation("abcde12345")).toEqual({
      applinks: {
        details: [
          {
            appIDs: ["ABCDE12345.market.maytha.app"],
            components: [
              { "/": "/products/*" },
              { "/": "/ar/products/*" },
              { "/": "/en/products/*" },
            ],
          },
        ],
      },
    });
  });
});
