import { createHmac } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  CloudApiSender,
  parseCloudWebhook,
  validCloudSignature,
} from "./cloud-api";

const webhook = {
  object: "whatsapp_business_account",
  entry: [
    {
      changes: [
        {
          value: {
            messages: [
              {
                id: "wamid.A",
                from: "970590000001",
                timestamp: "1760000000",
                type: "text",
                text: { body: "بدي جل غسيل" },
              },
              {
                id: "wamid.B",
                from: "970590000001",
                type: "image",
                image: { id: "media-1" },
              },
              {
                id: "wamid.C",
                from: "not-a-number",
                type: "text",
                text: { body: "x" },
              },
            ],
            statuses: [{ id: "wamid.out", status: "delivered" }],
          },
        },
      ],
    },
  ],
};

describe("cloud webhook", () => {
  it("reads text messages and flags media, ignoring statuses and bad senders", () => {
    const { messages, unsupported } = parseCloudWebhook(webhook);
    expect(messages).toEqual([
      {
        provider: "whatsapp",
        providerMessageId: "wamid.A",
        fromE164: "+970590000001",
        text: "بدي جل غسيل",
        receivedAt: new Date(1760000000 * 1000),
      },
    ]);
    expect(unsupported).toEqual([
      { providerMessageId: "wamid.B", fromE164: "+970590000001" },
    ]);
    expect(parseCloudWebhook({ junk: true })).toEqual({
      messages: [],
      unsupported: [],
    });
  });

  it("accepts only the app secret's signature", () => {
    const body = JSON.stringify(webhook);
    const signature = `sha256=${createHmac("sha256", "secret").update(body).digest("hex")}`;
    expect(validCloudSignature(body, signature, "secret")).toBe(true);
    expect(validCloudSignature(body, signature, "other")).toBe(false);
    expect(validCloudSignature(`${body} `, signature, "secret")).toBe(false);
    expect(validCloudSignature(body, null, "secret")).toBe(false);
  });
});

describe("cloud sender", () => {
  it("posts a Cloud API text message and returns the message id", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ messages: [{ id: "wamid.out" }] }),
    );
    const sender = new CloudApiSender({
      apiUrl: "https://waba.example/v1/",
      token: "t",
      authStyle: "d360",
      fetch: fetchMock as unknown as typeof fetch,
    });
    await expect(sender.sendText("+970590000001", "مرحبا")).resolves.toEqual({
      providerMessageId: "wamid.out",
    });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://waba.example/v1/messages");
    expect(init.headers).toMatchObject({ "D360-API-KEY": "t" });
    expect(JSON.parse(init.body as string)).toMatchObject({
      messaging_product: "whatsapp",
      to: "970590000001",
      type: "text",
      text: { body: "مرحبا" },
    });
  });

  it("throws when the provider refuses", async () => {
    const sender = new CloudApiSender({
      apiUrl: "https://graph.example/v21.0/123",
      token: "t",
      authStyle: "bearer",
      fetch: (async () => new Response("no", { status: 401 })) as typeof fetch,
    });
    await expect(sender.sendText("+970590000001", "x")).rejects.toThrow();
  });
});
