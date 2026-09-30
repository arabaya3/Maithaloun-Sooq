import { adminManifest } from "@/features/pwa/admin-manifest";

// Served outside /admin so the browser can fetch it without the session cookie.
export function GET() {
  return new Response(JSON.stringify(adminManifest), {
    headers: {
      "Content-Type": "application/manifest+json; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
