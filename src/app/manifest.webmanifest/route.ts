import { storefrontManifest } from "@/features/pwa/storefront-manifest";

// A route handler instead of app/manifest.ts, so /admin can link its own manifest.
export function GET() {
  return new Response(JSON.stringify(storefrontManifest), {
    headers: {
      "Content-Type": "application/manifest+json; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
