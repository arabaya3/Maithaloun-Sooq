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
} from "./make-payload";
import { makeConfigProblems, MakePublisher } from "./make-publisher";

const WEBHOOK = "https://hook.eu1.make.com/abc123def456";
const KEY = "make-api-key-0123456789";
const CAPTION =
  "✨ منعّم ومعطّر الملابس لويال – 750 مل\n\n💰 السعر: 10 ₪\n🚚 التوصيل داخل ميثلون بـ 5 ₪\n#مايثا_ماركت";
const IMAGE =
  "https://x.supabase.co/storage/v1/object/public/social-media/posts/1.jpg";

const request = (overrides: Partial<PublishRequest> = {}): PublishRequest => ({
  postId: "4fbdcdc6-b22c-420b-bb74-515483382a49",
  idempotencyKey: "a".repeat(64),
  format: "image",
  kind: "product",
  caption: CAPTION,
  mediaUrls: [IMAGE],
  posterUrl: null,
  attempt: 1,
  ...overrides,
});

function make(
  reply: (url: string, init?: RequestInit) => Response | Promise<Response>,
  supportsReels = false,
) {
  const fetch = vi.fn(async (url: string, init?: RequestInit) =>
    reply(url, init),
  );
  const publisher = new MakePublisher({
    webhookUrl: WEBHOOK,
    apiKey: KEY,
    supportsReels,
    pageId: "61595987361563",
    callbackUrl: null,
    fetch,
  });
  return { publisher, fetch };
}

describe("provider selection", () => {
  it("uses Meta unless Make is chosen explicitly", () => {
    expect(choosePublisherName(undefined)).toBe("meta");
    expect(choosePublisherName("")).toBe("meta");
    expect(choosePublisherName("MAKE")).toBe("meta");
    expect(choosePublisherName("make")).toBe("make");
  });

  it("wires Make only with an https make.com webhook and a real key", () => {
    const origin = "https://maithaloun-sooq.vercel.app";
    expect(makePublisherFromEnv({}, origin)).toBeNull();
    expect(
      makePublisherFromEnv({ MAKE_WEBHOOK_URL: WEBHOOK }, origin),
    ).toBeNull();
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

describe("Make webhook request", () => {
  it("posts the approved post as JSON with the API key only in x-make-apikey", async () => {
    const { publisher, fetch } = make(() => new Response("Accepted"));
    await publisher.publish(request());
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe(WEBHOOK);
    expect(init!.method).toBe("POST");
    const headers = init!.headers as Record<string, string>;
    expect(headers["x-make-apikey"]).toBe(KEY);
    expect(headers["Content-Type"]).toContain("application/json");
    expect(String(init!.body)).not.toContain(KEY);
    expect(JSON.parse(String(init!.body))).toEqual({
      schema: MAKE_PAYLOAD_SCHEMA,
      postId: "4fbdcdc6-b22c-420b-bb74-515483382a49",
      idempotencyKey: "a".repeat(64),
      attempt: 1,
      contentType: "image",
      caption: CAPTION,
      mediaUrl: IMAGE,
      coverUrl: null,
      pageId: "61595987361563",
      callbackUrl: null,
    });
  });

  it("keeps the Arabic caption byte for byte", async () => {
    const { publisher, fetch } = make(() => new Response("Accepted"));
    await publisher.publish(request());
    const sent = JSON.parse(String(fetch.mock.calls[0]![1]!.body)).caption;
    expect(Buffer.from(sent, "utf8").equals(Buffer.from(CAPTION, "utf8"))).toBe(
      true,
    );
  });

  it("uses only the scenario's content types: text, image, reel", () => {
    const context = { pageId: null, callbackUrl: null };
    expect(buildMakePayload(request({ mediaUrls: [] }), context)).toMatchObject(
      {
        contentType: "text",
        mediaUrl: null,
      },
    );
    expect(buildMakePayload(request(), context).contentType).toBe("image");
    expect(
      buildMakePayload(
        request({
          format: "reel",
          mediaUrls: ["https://x.co/r.mp4"],
          posterUrl: "https://x.co/p.jpg",
        }),
        context,
      ),
    ).toMatchObject({
      contentType: "reel",
      mediaUrl: "https://x.co/r.mp4",
      coverUrl: "https://x.co/p.jpg",
    });
  });

  it("refuses several images before calling Make", async () => {
    const many = request({
      mediaUrls: [IMAGE, IMAGE.replace("1.jpg", "2.jpg")],
    });
    expect(contentTypeOf(many)).toBeNull();
    expect(() =>
      buildMakePayload(many, { pageId: null, callbackUrl: null }),
    ).toThrow("MAKE_UNSUPPORTED_CONTENT");
    const { publisher, fetch } = make(() => new Response("Accepted"));
    await expect(publisher.publish(many)).rejects.toMatchObject({
      failure: { kind: "invalid_request" },
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("sends Reels only when enabled", async () => {
    const { publisher, fetch } = make(() => new Response("Accepted"));
    expect(publisher.supports("reel")).toBe(false);
    await expect(
      publisher.publish(
        request({ format: "reel", mediaUrls: ["https://x.co/r.mp4"] }),
      ),
    ).rejects.toMatchObject({ failure: { kind: "invalid_request" } });
    expect(fetch).not.toHaveBeenCalled();
    expect(
      make(() => new Response("Accepted"), true).publisher.supports("reel"),
    ).toBe(true);
  });
});

describe("Make webhook answers", () => {
  const outcome = async (reply: () => Response | Promise<Response>) =>
    make(reply).publisher.publish(request());

  it("marks published only with a valid Facebook object id", async () => {
    await expect(
      outcome(() =>
        Response.json({ facebookObjectId: "61595987361563_1234567" }),
      ),
    ).resolves.toEqual({
      kind: "published",
      objectId: "61595987361563_1234567",
      postId: "61595987361563_1234567",
    });
    await expect(
      outcome(() => Response.json({ id: 1234567890123 })),
    ).resolves.toMatchObject({
      kind: "published",
      objectId: "1234567890123",
    });
  });

  it("never treats a 200 without a valid id as published", async () => {
    for (const body of [
      "Accepted",
      "",
      "{not json",
      JSON.stringify({ status: "published" }),
      JSON.stringify({ id: "" }),
      JSON.stringify({ id: "abc" }),
      JSON.stringify({ id: "4fbdcdc6-b22c-420b-bb74-515483382a49" }),
      JSON.stringify({ id: "1" }),
      JSON.stringify({ id: "1234567_89012", facebookPostId: "9999999_12345" }),
    ]) {
      await expect(outcome(() => new Response(body))).resolves.toEqual({
        kind: "accepted",
        reference: null,
      });
    }
    expect(
      facebookIdFromReply({ id: "1234567_89012", objectId: "1234567_89012" }),
    ).toBe("1234567_89012");
  });

  it("422 (unsupported content) is a safe failure: nothing was posted", async () => {
    await expect(
      outcome(() => new Response("Unsupported content type", { status: 422 })),
    ).rejects.toMatchObject({
      failure: { kind: "invalid_request", code: 422 },
    });
  });

  it("502 (Facebook module failure) is an unknown outcome, never retried blindly", async () => {
    await expect(
      outcome(() => new Response("", { status: 502 })),
    ).rejects.toMatchObject({
      failure: { kind: "unknown_outcome", code: 502 },
    });
    await expect(
      outcome(() => new Response("", { status: 500 })),
    ).rejects.toMatchObject({
      failure: { kind: "unknown_outcome" },
    });
  });

  it("separates refusals from lost answers", async () => {
    await expect(
      outcome(() => new Response("", { status: 401 })),
    ).rejects.toMatchObject({
      failure: { kind: "auth" },
    });
    await expect(
      outcome(() => new Response("", { status: 403 })),
    ).rejects.toMatchObject({
      failure: { kind: "auth" },
    });
    await expect(
      outcome(() => new Response("", { status: 429 })),
    ).rejects.toMatchObject({
      failure: { kind: "rate_limit" },
    });
    await expect(
      outcome(() => {
        throw new Error("socket hang up");
      }),
    ).rejects.toMatchObject({ failure: { kind: "unknown_outcome" } });
    await expect(
      outcome(() => {
        throw new DOMException("timed out", "TimeoutError");
      }),
    ).rejects.toMatchObject({ failure: { kind: "unknown_outcome" } });
  });
});

describe("public media check", () => {
  const head = (status: number, headers: Record<string, string>) =>
    vi.fn(async () => new Response(null, { status, headers }));

  it("accepts a reachable public JPEG and MP4 within Meta's limits", async () => {
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
  });

  it("refuses private, unreachable, mistyped or oversized media", async () => {
    const ok = head(200, { "content-type": "image/jpeg" });
    await expect(
      checkPublicMedia("http://x.co/a.jpg", "image", ok),
    ).resolves.toBe("MEDIA_NOT_PUBLIC");
    await expect(
      checkPublicMedia("/admin/api/social/media/a.jpg", "image", ok),
    ).resolves.toBe("MEDIA_NOT_PUBLIC");
    await expect(
      checkPublicMedia("https://user:pw@x.co/a.jpg", "image", ok),
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
