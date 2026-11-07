import { NextResponse } from "next/server";

import { revalidateStorefront } from "@/features/catalog/application/revalidate-storefront";
import { testDoublesAllowed } from "@/server/env/isolated-test-server";

export const dynamic = "force-dynamic";

/**
 * e2e only: tests that write to the test database directly (not through admin actions) refresh the
 * cached storefront here, as an admin change would. A 404 everywhere else, including every deployment.
 */
export function POST() {
  if (!testDoublesAllowed()) return new NextResponse(null, { status: 404 });
  revalidateStorefront();
  return NextResponse.json({ ok: true });
}
