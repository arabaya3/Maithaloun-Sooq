import { after, NextResponse } from "next/server";

import {
  liveAssistantEnabled,
  liveSender,
  shopAssistantService,
} from "@/features/shop-assistant/application/shop-assistant-instance";
import {
  parseCloudWebhook,
  sameSecret,
  validCloudSignature,
} from "@/features/shop-assistant/infrastructure/cloud-api";
import { errorCode, logEvent } from "@/server/log/ops-log";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_WEBHOOK_BYTES = 256_000;

/** Meta's subscription check: echo the challenge only for our own verify token. */
export function GET(request: Request) {
  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN?.trim();
  const params = new URL(request.url).searchParams;
  if (
    !verifyToken ||
    params.get("hub.mode") !== "subscribe" ||
    !sameSecret(params.get("hub.verify_token"), verifyToken)
  ) {
    return new NextResponse(null, { status: 403 });
  }
  return new NextResponse(params.get("hub.challenge") ?? "", {
    headers: { "content-type": "text/plain" },
  });
}

/**
 * Customer messages from the WhatsApp Cloud API (Meta or 360dialog). The request is answered
 * at once and the replies are sent after the response, as the provider expects.
 */
export async function POST(request: Request) {
  const appSecret = process.env.WHATSAPP_APP_SECRET?.trim();
  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN?.trim();
  if (!appSecret && !verifyToken) {
    return new NextResponse(null, { status: 404 });
  }
  const raw = await request.text();
  if (raw.length > MAX_WEBHOOK_BYTES) {
    return new NextResponse(null, { status: 413 });
  }
  // Meta signs the body with the app secret; a provider that cannot sign uses a secret in the URL.
  const authentic = appSecret
    ? validCloudSignature(
        raw,
        request.headers.get("x-hub-signature-256"),
        appSecret,
      )
    : sameSecret(
        new URL(request.url).searchParams.get("key"),
        verifyToken as string,
      );
  if (!authentic) return new NextResponse(null, { status: 401 });

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return new NextResponse(null, { status: 400 });
  }

  const sender = liveSender();
  if (!liveAssistantEnabled() || !sender) {
    return NextResponse.json({ ok: true, handled: 0 });
  }
  const { messages, unsupported } = parseCloudWebhook(body);
  const inbound = [
    ...messages,
    ...unsupported.map((item) => ({
      ...item,
      provider: "whatsapp",
      text: "(the customer sent a photo, voice note or file; only text can be read)",
      receivedAt: new Date(),
    })),
  ];
  after(async () => {
    for (const message of inbound) {
      try {
        await shopAssistantService.handleInbound(message, sender);
      } catch (error) {
        logEvent("error", "shop_assistant.inbound.failed", {
          code: errorCode(error),
        });
      }
    }
  });
  return NextResponse.json({ ok: true, handled: inbound.length });
}
