import { NextResponse } from "next/server";

export const NO_STORE_HEADERS = { "Cache-Control": "no-store, max-age=0" };

export function jsonNoStore(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE_HEADERS });
}

export function unauthorizedJson() {
  return jsonNoStore(
    { ok: false, message: "انتهت الجلسة أو لا تملكين الصلاحية." },
    401,
  );
}
