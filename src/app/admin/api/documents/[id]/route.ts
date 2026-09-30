import { NextResponse } from "next/server";

import { extractionService } from "@/features/admin/application/admin-services";
import { unauthorizedJson } from "@/features/admin/auth/admin-api-response";
import { authorizeAdminApi } from "@/features/admin/auth/authorize-admin-api";
import { AuthorizationError } from "@/features/admin/domain/admin-actor";
import { getPrivateDocumentStore } from "@/server/storage/private-documents";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SIGNED_URL_SECONDS = 60;

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const actor = await authorizeAdminApi(request);
  if (!actor) return unauthorizedJson();
  try {
    const document = await extractionService.getDocument(
      actor,
      (await context.params).id,
    );
    if (!document) return new Response(null, { status: 404 });
    const location = {
      provider: document.storageProvider as "supabase" | "local",
      bucket: document.bucket,
      path: document.path,
    };
    const store = getPrivateDocumentStore();
    // Private files are reachable only through a short-lived signed URL issued after this check.
    const signedUrl = await store.signedUrl(location, SIGNED_URL_SECONDS);
    if (signedUrl) {
      return NextResponse.redirect(signedUrl, {
        status: 302,
        headers: { "Cache-Control": "no-store, max-age=0" },
      });
    }
    const bytes = await store.read(location);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": document.mimeType,
        "Content-Disposition": "inline",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "no-store, max-age=0",
      },
    });
  } catch (error) {
    if (error instanceof AuthorizationError) return unauthorizedJson();
    throw error;
  }
}
