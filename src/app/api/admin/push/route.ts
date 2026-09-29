import { NextResponse } from "next/server";

import { adminNotificationService } from "@/features/admin/application/admin-services";
import { authorizeAdminApi } from "@/features/admin/auth/authorize-admin-api";

export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "no-store, max-age=0" };

export async function GET(request: Request) {
  const actor = await authorizeAdminApi(request);
  if (!actor) {
    return NextResponse.json({ ok: false }, { status: 401, headers });
  }
  return NextResponse.json(
    { ok: true, publicKey: adminNotificationService.getPublicKey() },
    { headers },
  );
}

export async function POST(request: Request) {
  const actor = await authorizeAdminApi(request, true);
  if (!actor) {
    return NextResponse.json({ ok: false }, { status: 401, headers });
  }
  try {
    await adminNotificationService.saveSubscription(
      actor,
      await request.json(),
    );
    return NextResponse.json({ ok: true }, { headers });
  } catch {
    return NextResponse.json(
      { ok: false, message: "تعذّر تفعيل الإشعارات." },
      { status: 400, headers },
    );
  }
}

export async function DELETE(request: Request) {
  const actor = await authorizeAdminApi(request, true);
  if (!actor) {
    return NextResponse.json({ ok: false }, { status: 401, headers });
  }
  const input = (await request.json()) as { endpoint?: unknown };
  await adminNotificationService.removeSubscription(
    actor,
    typeof input.endpoint === "string" ? input.endpoint : "",
  );
  return NextResponse.json({ ok: true }, { headers });
}
