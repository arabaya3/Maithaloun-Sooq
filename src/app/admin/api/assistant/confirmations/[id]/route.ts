import { revalidatePath } from "next/cache";
import { z } from "zod";

import { assistantConfirmations } from "@/features/admin/application/admin-services";
import { jsonNoStore } from "@/features/admin/auth/admin-api-response";
import { authorizeAssistant } from "@/features/assistant/application/assistant-access";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const actionSchema = z
  .object({
    action: z.enum(["confirm", "cancel"]),
    operation: z.string().max(60),
    token: z.string().max(80),
  })
  .strict();

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const access = await authorizeAssistant(request, { mutation: false });
  if (access instanceof Response) return access;
  const { id } = await context.params;
  const view = await assistantConfirmations.view(access.actor, id);
  if (!view)
    return jsonNoStore({ ok: false, message: "البطاقة غير موجودة." }, 404);
  return jsonNoStore({ ok: true, confirmation: view });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const access = await authorizeAssistant(request, {
    mutation: true,
    limit: "mutation",
  });
  if (access instanceof Response) return access;
  if (access.mode !== "full") {
    return jsonNoStore(
      { ok: false, message: "التعديلات عبر المساعد غير مفعّلة." },
      403,
    );
  }
  const { id } = await context.params;
  let body;
  try {
    body = actionSchema.safeParse(await request.json());
  } catch {
    body = null;
  }
  if (!body?.success) {
    return jsonNoStore({ ok: false, message: "طلب غير صالح." }, 400);
  }
  if (body.data.action === "cancel") {
    const cancelled = await assistantConfirmations.cancel(access.actor, id);
    return jsonNoStore(
      { ok: cancelled, status: "cancelled" },
      cancelled ? 200 : 409,
    );
  }
  const outcome = await assistantConfirmations.confirm(access.actor, {
    id,
    operation: body.data.operation,
    token: body.data.token,
  });
  if (outcome.ok) {
    revalidatePath("/admin", "layout");
    revalidatePath("/", "layout");
  }
  return jsonNoStore(
    outcome,
    outcome.ok ? 200 : outcome.status === "failed" ? 422 : 409,
  );
}
