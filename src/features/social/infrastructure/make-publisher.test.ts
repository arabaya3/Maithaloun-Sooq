import { describe, expect, it, vi } from "vitest";

import { makePublisherFromEnv } from "@/features/social/application/social-factory";
import {
  choosePublisherName,
  type PublishRequest,
} from "@/features/social/domain/publisher";

import { checkPublicMedia } from "./media-check";
import {
  buildMakePayload,
  contentTypeOf,
  facebookIdFromReply,
  MAKE_PAYLOAD_SCHEMA,
  makeRequestSchema,
} from "./make-payload";
import { makeConfigProblems, MakePublisher } from "./make-publisher";

const WEBHOOK = "https://hook.eu1.make.com/abc123def456";
const KEY = "make-api-key-0123456789";
const POST_ID = "4fbdcdc6-b22c-420b-bb74-515483382a49";
const IDEMPOTENCY = "a".repeat(64);
const CAPTION =
  "✨ منعّم ومعطّر الملابس لويال – 750 مل\n\n💰 السعر: 10 ₪\n🚚 التوصيل داخل ميثلون بـ 5 ₪\n#مايثا_ماركت";
const IMAGE =
  "https://x.supabase.co/storage/v1/object/public/social-media/posts/1.jpg";
const VIDEO =
  "https://x.supabase.co/storage/v1/object/public/social-media/posts/1.mp4";
const POSTER =
  "https://x.supabase.co/storage/v1/object/public/social-media/posts/1-poster.jpg";

const request = (overrides: Partial<PublishRequest> = {}): PublishRequest => ({
  postId: POST_ID,
  idempotencyKey: IDEMPOTENCY,
  format: "image",
  kind: "product",
  caption: CAPTION,
  mediaUrls: [IMAGE],
  posterUrl: null,
  attempt: 1,
  ...overrides,
});
const reel = (overrides: Partial<PublishRequest> = {}) =>
  request({
    format: "reel",
    mediaUrls: [VIDEO],
    posterUrl: POSTER,
    ...overrides,
  });

function make(
  reply: (url: string, init?: RequestInit) => Response | Promise<Response>,
  options: {
    supportsReels?: boolean;
    pageId?: string | null;
    callbackUrl?: string | null;
  } = {},
) {
  const fetch = vi.fn(async (url: string, init?: RequestInit) =>
    reply(url, init),
  );
  const publisher = new MakePublisher({
    webhookUrl: WEBHOOK,
    apiKey: KEY,
    supportsReels: options.supportsReels ?? false,
    pageId: options.pageId === undefined ? "61595987361563" : options.pageId,
    callbackUrl: options.callbackUrl ?? null,
    fetch,
  });
  return { publisher, fetch };
}
const sentBody = (fetch: ReturnType<typeof make>["fetch"]) =>
  JSON.parse(String(fetch.mock.calls[0]![1]!.body)) as Record<string, unknown>;

describe("provider selection", () => {
  it("uses Meta unless Make is chosen explicitly", () => {
    expect(choosePublisherName(undefined)).toBe("meta");
    expect(choosePublisherName("MAKE")).toBe("meta");
    expect(choosePublisherName("make")).toBe("make");
  });

  it("wires Make only with an https make.com webhook and a real key", () => {
    const origin = "https://maithaloun-sooq.vercel.app";
    expect(makePublisherFromEnv({}, origin)).toBeNull();
    expect(
      makePublisherFromEnv(
        {
          MAKE_WEBHOOK_URL: "http://hook.eu1.make.com/x",
          MAKE_WEBHOOK_API_KEY: KEY,
        },
        origin,
      ),
    ).toBeNull();
    expect(
      makeConfigProblems({
        MAKE_WEBHOOK_URL: "https://make.com.evil.example/x",
        MAKE_WEBHOOK_API_KEY: KEY,
      }),
    ).toContain("MAKE_WEBHOOK_URL_HOST");
    expect(
      makePublisherFromEnv(
        { MAKE_WEBHOOK_URL: WEBHOOK, MAKE_WEBHOOK_API_KEY: KEY },
        origin,
      ),
    ).toBeInstanceOf(MakePublisher);
  });
});

describe("Make request serialization", () => {
  it("image: exactly the scenario's fields, no nulls, key only in the header", async () => {
    const { publisher, fetch } = make(() => new Response("Accepted"));
    await publisher.publish(request());
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe(WEBHOOK);
    const headers = init!.headers as Record<string, string>;
    expect(headers["x-make-apikey"]).toBe(KEY);
    expect(headers["Content-Type"]).toContain("application/json");
    expect(String(init!.body)).not.toContain(KEY);
    expect(String(init!.body)).not.toContain("null");
    expect(sentBody(fetch)).toEqual({
      postId: POST_ID,
      idempotencyKey: IDEMPOTENCY,
      contentType: "image",
      caption: CAPTION,
      mediaUrl: IMAGE,
      pageId: "61595987361563",
      schema: MAKE_PAYLOAD_SCHEMA,
      attempt: 1,
    });
  });

  it("text: no mediaUrl, coverUrl or empty optional fields at all", async () => {
    const { publisher, fetch } = make(() => new Response("Accepted"), {
      pageId: null,
    });
    await publisher.publish(request({ mediaUrls: [] }));
    expect(sentBody(fetch)).toEqual({
      postId: POST_ID,
      idempotencyKey: IDEMPOTENCY,
      contentType: "text",
      caption: CAPTION,
      schema: MAKE_PAYLOAD_SCHEMA,
      attempt: 1,
    });
  });

  it("reel: the public video and its cover", async () => {
    const { publisher, fetch } = make(() => new Response("Accepted"), {
      supportsReels: true,
      callbackUrl:
        "https://maithaloun-sooq.vercel.app/api/social/make/callback",
    });
    await publisher.publish(reel());
    expect(sentBody(fetch)).toEqual({
      postId: POST_ID,
      idempotencyKey: IDEMPOTENCY,
      contentType: "reel",
      caption: CAPTION,
      mediaUrl: VIDEO,
      coverUrl: POSTER,
      pageId: "61595987361563",
      callbackUrl:
        "https://maithaloun-sooq.vercel.app/api/social/make/callback",
      schema: MAKE_PAYLOAD_SCHEMA,
      attempt: 1,
    });
  });

  it("every payload matches the scenario's strict schema with the right types", () => {
    const context = { pageId: "61595987361563", callbackUrl: null };
    const payloads = [
      buildMakePayload(request({ mediaUrls: [] }), context),
      buildMakePayload(request(), context),
      buildMakePayload(reel(), context),
    ];
    for (const payload of payloads) {
      expect(makeRequestSchema.safeParse(payload).success).toBe(true);
      for (const field of [
        "postId",
        "idempotencyKey",
        "contentType",
        "caption",
      ] as const) {
        expect(typeof payload[field]).toBe("string");
      }
      expect(typeof payload.attempt).toBe("number");
      expect(
        Object.values(payload).some(
          (value) => value === null || value === undefined,
        ),
      ).toBe(false);
    }
    const image = payloads[1]!;
    expect(makeRequestSchema.safeParse({ ...image, extra: "x" }).success).toBe(
      false,
    );
    expect(
      makeRequestSchema.safeParse({ ...image, mediaUrl: null }).success,
    ).toBe(false);
    expect(
      makeRequestSchema.safeParse({ ...image, attempt: "1" }).success,
    ).toBe(false);
  });

  it("keeps the Arabic caption byte for byte", async () => {
    const { publisher, fetch } = make(() => new Response("Accepted"));
    await publisher.publish(request());
    const sent = String(sentBody(fetch).caption);
    expect(Buffer.from(sent, "utf8").equals(Buffer.from(CAPTION, "utf8"))).toBe(
      true,
    );
  });

  it("refuses several images, disabled Reels and invalid payloads before calling Make", async () => {
    const many = request({
      mediaUrls: [IMAGE, IMAGE.replace("1.jpg", "2.jpg")],
    });
    expect(contentTypeOf(many)).toBeNull();
    const { publisher, fetch } = make(() => new Response("Accepted"));
    for (const bad of [
      many,
      reel(),
      request({ caption: "" }),
      request({ mediaUrls: ["http://insecure.example/x.jpg"] }),
    ]) {
      await expect(publisher.publish(bad)).rejects.toMatchObject({
        failure: { kind: "invalid_request" },
      });
    }
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("Make replies", () => {
  const expectFor = (contentType: "text" | "image" | "reel") => ({
    contentType,
    postId: POST_ID,
    idempotencyKey: IDEMPOTENCY,
  });
  const PAGE_POST = "61595987361563_12345";

  it("image and text read facebookPostId; Reels read facebookObjectId", () => {
    expect(
      facebookIdFromReply({ facebookPostId: PAGE_POST }, expectFor("image")),
    ).toBe(PAGE_POST);
    expect(
      facebookIdFromReply({ facebookPostId: PAGE_POST }, expectFor("text")),
    ).toBe(PAGE_POST);
    expect(
      facebookIdFromReply(
        { facebookObjectId: "1234567890123" },
        expectFor("reel"),
      ),
    ).toBe("1234567890123");
    expect(
      facebookIdFromReply(
        { facebookObjectId: "1234567890123" },
        expectFor("image"),
      ),
    ).toBeNull();
    expect(
      facebookIdFromReply({ facebookPostId: PAGE_POST }, expectFor("reel")),
    ).toBeNull();
  });

  it("refuses a reply about another post or another approval", () => {
    expect(
      facebookIdFromReply(
        {
          facebookPostId: PAGE_POST,
          postId: POST_ID,
          idempotencyKey: IDEMPOTENCY,
        },
        expectFor("image"),
      ),
    ).toBe(PAGE_POST);
    expect(
      facebookIdFromReply(
        {
          facebookPostId: PAGE_POST,
          postId: "00000000-0000-4000-8000-000000000001",
        },
        expectFor("image"),
      ),
    ).toBeNull();
    expect(
      facebookIdFromReply(
        { facebookPostId: PAGE_POST, idempotencyKey: "b".repeat(64) },
        expectFor("image"),
      ),
    ).toBeNull();
  });

  it("publishes on a 200 with the right id for the content type", async () => {
    await expect(
      make(() =>
        Response.json({ facebookPostId: PAGE_POST }),
      ).publisher.publish(request()),
    ).resolves.toEqual({
      kind: "published",
      objectId: PAGE_POST,
      postId: PAGE_POST,
    });
    await expect(
      make(() => Response.json({ facebookObjectId: "1234567890123" }), {
        supportsReels: true,
      }).publisher.publish(reel()),
    ).resolves.toMatchObject({ kind: "published", objectId: "1234567890123" });
  });

  it("never treats a 200 without a valid, matching id as published", async () => {
    for (const body of [
      "Accepted",
      "",
      "{not json",
      "[]",
      JSON.stringify({ status: "published" }),
      JSON.stringify({ facebookPostId: "" }),
      JSON.stringify({ facebookPostId: "abc" }),
      JSON.stringify({ facebookPostId: POST_ID }),
      JSON.stringify({ facebookObjectId: PAGE_POST }),
      JSON.stringify({ facebookPostId: PAGE_POST, postId: "someone-else" }),
      JSON.stringify({
        facebookPostId: PAGE_POST,
        idempotencyKey: "c".repeat(64),
      }),
    ]) {
      await expect(
        make(() => new Response(body)).publisher.publish(request()),
      ).resolves.toEqual({
        kind: "accepted",
        reference: null,
      });
    }
  });

  it("422 is a safe failure; 502, 5xx and timeouts are unknown outcomes", async () => {
    const outcome = (reply: () => Response) =>
      make(reply).publisher.publish(request());
    await expect(
      outcome(() => new Response("Unsupported", { status: 422 })),
    ).rejects.toMatchObject({
      failure: { kind: "invalid_request", code: 422 },
    });
    await expect(
      outcome(() => new Response("", { status: 502 })),
    ).rejects.toMatchObject({
      failure: { kind: "unknown_outcome", code: 502 },
    });
    await expect(
      outcome(() => new Response("", { status: 503 })),
    ).rejects.toMatchObject({
      failure: { kind: "unknown_outcome" },
    });
    await expect(
      outcome(() => new Response("", { status: 401 })),
    ).rejects.toMatchObject({
      failure: { kind: "auth" },
    });
    await expect(
      outcome(() => new Response("", { status: 429 })),
    ).rejects.toMatchObject({
      failure: { kind: "rate_limit" },
    });
    await expect(
      make(() => {
        throw new DOMException("timed out", "TimeoutError");
      }).publisher.publish(request()),
    ).rejects.toMatchObject({ failure: { kind: "unknown_outcome" } });
  });
});

describe("public media check", () => {
  const head = (status: number, headers: Record<string, string>) =>
    vi.fn(async () => new Response(null, { status, headers }));

  it("accepts reachable public media within Meta's limits and refuses everything else", async () => {
    await expect(
      checkPublicMedia(
        "https://x.co/a.jpg",
        "image",
        head(200, { "content-type": "image/jpeg", "content-length": "250000" }),
      ),
    ).resolves.toBeNull();
    await expect(
      checkPublicMedia(
        "https://x.co/a.mp4",
        "video",
        head(200, { "content-type": "video/mp4" }),
      ),
    ).resolves.toBeNull();
    const ok = head(200, { "content-type": "image/jpeg" });
    await expect(
      checkPublicMedia("http://x.co/a.jpg", "image", ok),
    ).resolves.toBe("MEDIA_NOT_PUBLIC");
    await expect(
      checkPublicMedia("https://127.0.0.1/a.jpg", "image", ok),
    ).resolves.toBe("MEDIA_NOT_PUBLIC");
    expect(ok).not.toHaveBeenCalled();
    await expect(
      checkPublicMedia("https://x.co/a.jpg", "image", head(404, {})),
    ).resolves.toBe("MEDIA_NOT_REACHABLE");
    await expect(
      checkPublicMedia(
        "https://x.co/a.jpg",
        "image",
        head(200, { "content-type": "text/html" }),
      ),
    ).resolves.toBe("MEDIA_WRONG_TYPE");
    await expect(
      checkPublicMedia(
        "https://x.co/a.jpg",
        "image",
        head(200, {
          "content-type": "image/jpeg",
          "content-length": "5000000",
        }),
      ),
    ).resolves.toBe("MEDIA_TOO_LARGE");
  });
});
