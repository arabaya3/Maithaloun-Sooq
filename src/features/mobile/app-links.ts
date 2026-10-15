// Verification files that let the store's own https links open the MAYTHA MARKET app:
// Android App Links (assetlinks.json) and iOS Universal Links (apple-app-site-association).
// Both depend on values only the owner has (the Play upload/app-signing certificate and the
// Apple Team ID), so they come from the environment and stay absent until set.

export const APP_ID = "market.maytha.app";
export const APP_LINK_PATHS = [
  "/products/*",
  "/ar/products/*",
  "/en/products/*",
];

const SHA256_FINGERPRINT = /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/;
const APPLE_TEAM_ID = /^[A-Z0-9]{10}$/;

/** Comma-separated SHA-256 certificate fingerprints, e.g. the upload key and Play's app-signing key. */
export function androidAssetLinks(fingerprints: string | undefined) {
  const valid = (fingerprints ?? "")
    .split(",")
    .map((value) => value.trim().toUpperCase())
    .filter((value) => SHA256_FINGERPRINT.test(value));
  if (!valid.length) return null;
  return [
    {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: {
        namespace: "android_app",
        package_name: APP_ID,
        sha256_cert_fingerprints: valid,
      },
    },
  ];
}

export function appleAppSiteAssociation(teamId: string | undefined) {
  const team = teamId?.trim().toUpperCase();
  if (!team || !APPLE_TEAM_ID.test(team)) return null;
  return {
    applinks: {
      details: [
        {
          appIDs: [`${team}.${APP_ID}`],
          components: APP_LINK_PATHS.map((path) => ({ "/": path })),
        },
      ],
    },
  };
}
