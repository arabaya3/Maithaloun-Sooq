import { randomBytes } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { MetaApiError } from "@/features/social/domain/meta-errors";

import {
  appSecretProof,
  inspectToken,
  MetaGraphClient,
  requiredPageScopes,
  sameCaption,
  tokenProblems,
} from "./meta-graph-client";
import { choosePage, loginDialogUrl } from "./meta-oauth";
import {
  openToken,
  parseVaultKey,
  sealToken,
  TokenVaultError,
} from "./token-vault";
import { isPublishableMediaUrl, readLocalMedia } from "./media-store";
import { ffmpegArgs, reelDurationSeconds } from "./render/reel-templates";

function json(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

describe("token vault", () => {
  const key = randomBytes(32);
  it("round-trips and never stores the token in clear", () => {
    const sealed = sealToken("EAAB-page-token-secret", key);
    expect(sealed).not.toContain("secret");
    expect(openToken(sealed, key)).toBe("EAAB-page-token-secret");
  });
  it("rejects a wrong key, tampering and a missing key", () => {
    const sealed = sealToken("token-value-123456", key);
    expect(() => openToken(sealed, randomBytes(32))).toThrow(TokenVaultError);
    expect(() => openToken(`${sealed.slice(0, -2)}AA`, key)).toThrow(
      TokenVaultError,
    );
    expect(() => parseVaultKey(undefined)).toThrow("KEY_MISSING");
    expect(() => parseVaultKey(Buffer.alloc(16).toString("base64"))).toThrow(
      "KEY_INVALID",
    );
  });
});

describe("Meta Graph client (mocked API)", () => {
  it("publishes a photo with the Page token in a header, not the URL", async () => {
    const fetch = vi.fn(async () =>
      json({ id: "photo1", post_id: "page_post1" }),
    );
    const client = new MetaGraphClient({
      pageId: "123",
      pageToken: "TOKEN",
      fetch,
    });
    await expect(
      client.publishPhoto({ imageUrl: "https://cdn/x.jpg", caption: "مرحبا" }),
    ).resolves.toEqual({ objectId: "photo1", postId: "page_post1" });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://graph.facebook.com/v25.0/123/photos");
    expect(url).not.toContain("TOKEN");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer TOKEN",
    );
    expect(String(init.body)).toContain("published=true");
  });

  it("runs the three Reels phases in order", async () => {
    const calls: string[] = [];
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(url);
      if (url.includes("rupload")) {
        expect((init!.headers as Record<string, string>).file_url).toBe(
          "https://cdn/r.mp4",
        );
        return json({ success: true });
      }
      return String(init?.body).includes("start")
        ? json({ video_id: "v1" })
        : json({ success: true, post_id: "p1" });
    });
    const client = new MetaGraphClient({
      pageId: "123",
      pageToken: "T",
      fetch,
    });
    await expect(
      client.publishReel({ videoUrl: "https://cdn/r.mp4", caption: "ريل" }),
    ).resolves.toEqual({ objectId: "v1", postId: "p1" });
    expect(calls).toEqual([
      "https://graph.facebook.com/v25.0/123/video_reels",
      "https://rupload.facebook.com/video-upload/v25.0/v1",
      "https://graph.facebook.com/v25.0/123/video_reels",
    ]);
  });

  it("turns an expired token and throttling into typed failures", async () => {
    const expired = new MetaGraphClient({
      pageId: "1",
      pageToken: "T",
      fetch: async () => json({ error: { code: 190 } }, 400),
    });
    await expect(
      expired.publishPhoto({ imageUrl: "https://x", caption: "c" }),
    ).rejects.toMatchObject({ failure: { kind: "auth" } });
    const throttled = new MetaGraphClient({
      pageId: "1",
      pageToken: "T",
      fetch: async () =>
        json({ error: { code: 4 } }, 400, { "retry-after": "60" }),
    });
    await expect(
      throttled.publishPhoto({ imageUrl: "https://x", caption: "c" }),
    ).rejects.toMatchObject({
      failure: { kind: "rate_limit", retryAfterMs: 60_000 },
    });
    const down = new MetaGraphClient({
      pageId: "1",
      pageToken: "T",
      fetch: async () => {
        throw new Error("network");
      },
    });
    await expect(
      down.publishPhoto({ imageUrl: "https://x", caption: "c" }),
    ).rejects.toBeInstanceOf(MetaApiError);
  });

  it("reads engagement and tolerates missing insights permission", async () => {
    const fetch = vi.fn(async (url: string) =>
      url.includes("/insights")
        ? json({ error: { code: 10 } }, 403)
        : json({
            shares: { count: 2 },
            reactions: { summary: { total_count: 7 } },
            comments: { summary: { total_count: 3 } },
          }),
    );
    const client = new MetaGraphClient({ pageId: "1", pageToken: "T", fetch });
    await expect(client.engagement("p1")).resolves.toEqual({
      reactions: 7,
      comments: 3,
      shares: 2,
      reach: null,
      views: null,
    });
  });

  it("inspects token expiry with the app credentials", async () => {
    const result = await inspectToken({
      token: "T",
      appId: "app",
      appSecret: "secret",
      fetch: async () =>
        json({
          data: {
            is_valid: true,
            expires_at: 0,
            scopes: ["pages_manage_posts"],
          },
        }),
    });
    expect(result).toEqual({
      valid: true,
      expiresAt: null,
      dataAccessExpiresAt: null,
      scopes: ["pages_manage_posts"],
      appId: null,
      profileId: null,
    });
  });

  it("rejects tokens for another app, another Page or with missing permissions", () => {
    const base = {
      valid: true,
      expiresAt: null,
      dataAccessExpiresAt: null,
      scopes: [...requiredPageScopes],
      appId: "app",
      profileId: "61595987361563",
    };
    const expected = { appId: "app", pageId: "61595987361563" };
    expect(tokenProblems(base, expected)).toEqual([]);
    expect(tokenProblems({ ...base, appId: "other" }, expected)).toEqual([
      "wrong_app",
    ]);
    expect(tokenProblems({ ...base, profileId: "123" }, expected)).toEqual([
      "wrong_page",
    ]);
    expect(
      tokenProblems({ ...base, scopes: ["pages_manage_posts"] }, expected),
    ).toEqual(["missing_scopes"]);
    expect(tokenProblems({ ...base, valid: false }, expected)).toEqual([
      "invalid",
    ]);
  });

  it("signs every Graph call with appsecret_proof when the app secret is known", async () => {
    const fetch = vi.fn(async () => json({ id: "c1" }));
    const client = new MetaGraphClient({
      pageId: "1",
      pageToken: "TOKEN",
      appSecret: "SECRET",
      fetch,
    });
    await client.replyToComment("c0", "رد");
    const [url] = fetch.mock.calls[0] as unknown as [string];
    expect(new URL(url).searchParams.get("appsecret_proof")).toBe(
      appSecretProof("TOKEN", "SECRET"),
    );
    expect(url).not.toContain("SECRET");
  });

  it("never retries a publish whose answer was lost", async () => {
    for (const reply of [
      async () => {
        throw new Error("socket hang up");
      },
      async () => new Response("<html>bad gateway</html>", { status: 502 }),
      async () => new Response("not json", { status: 200 }),
    ]) {
      const client = new MetaGraphClient({
        pageId: "1",
        pageToken: "T",
        fetch: reply,
      });
      await expect(
        client.publishPhoto({ imageUrl: "https://x", caption: "c" }),
      ).rejects.toMatchObject({ failure: { kind: "unknown_outcome" } });
    }
    // A read failing the same way is an ordinary transient error.
    const reader = new MetaGraphClient({
      pageId: "1",
      pageToken: "T",
      fetch: async () => {
        throw new Error("x");
      },
    });
    await expect(reader.comments("p")).rejects.toMatchObject({
      failure: { kind: "transient" },
    });
  });

  it("stores the Reel's video id before the final publish call", async () => {
    const seen: string[] = [];
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("rupload")) return json({ success: true });
      if (String(init?.body).includes("start")) return json({ video_id: "v9" });
      expect(seen).toEqual(["v9"]);
      throw new Error("lost");
    });
    const client = new MetaGraphClient({ pageId: "1", pageToken: "T", fetch });
    await expect(
      client.publishReel({
        videoUrl: "https://cdn/r.mp4",
        caption: "c",
        onUploadStarted: async (id) => {
          seen.push(id);
        },
      }),
    ).rejects.toMatchObject({ failure: { kind: "unknown_outcome" } });
  });

  it("reads a Reel's state from its phases", async () => {
    const state = (status: unknown) =>
      new MetaGraphClient({
        pageId: "1",
        pageToken: "T",
        fetch: async () => json({ status }),
      }).reelState("v");
    await expect(
      state({
        video_status: "ready",
        publishing_phase: { status: "complete" },
      }),
    ).resolves.toBe("published");
    await expect(
      state({
        video_status: "processing",
        publishing_phase: { status: "completed" },
      }),
    ).resolves.toBe("published");
    await expect(
      state({
        processing_phase: { status: "in_progress" },
        publishing_phase: { status: "not_started" },
        uploading_phase: { status: "complete" },
      }),
    ).resolves.toBe("processing");
    await expect(
      state({
        uploading_phase: { status: "not_started" },
        publishing_phase: { status: "not_started" },
      }),
    ).resolves.toBe("not_published");
    await expect(state({ video_status: "error" })).resolves.toBe("failed");
  });

  it("matches captions the way a reader would", () => {
    expect(sameCaption("سطر  أول\n\nسطر ثاني ", "سطر أول\nسطر ثاني")).toBe(
      true,
    );
    expect(sameCaption("منشور 1", "منشور 2")).toBe(false);
  });
});

describe("Facebook Login", () => {
  it("asks only for Page permissions, never ads", () => {
    const url = new URL(
      loginDialogUrl(
        { appId: "1", appSecret: "", redirectUri: "https://shop/cb" },
        "state",
      ),
    );
    const scopes = url.searchParams.get("scope")!.split(",");
    expect(scopes).toContain("pages_manage_posts");
    expect(scopes.some((scope) => scope.startsWith("ads_"))).toBe(false);
    expect(url.searchParams.get("state")).toBe("state");
  });
  it("uses the Login for Business configuration instead of scopes when one is set", () => {
    const url = new URL(
      loginDialogUrl(
        {
          appId: "1",
          appSecret: "",
          redirectUri: "https://shop/cb",
          loginConfigId: "cfg",
        },
        "s",
      ),
    );
    expect(url.searchParams.get("config_id")).toBe("cfg");
    expect(url.searchParams.has("scope")).toBe(false);
  });
  it("never picks a Page by guessing among several", () => {
    const pages = [
      { id: "1", name: "a", accessToken: "x" },
      { id: "2", name: "b", accessToken: "y" },
    ];
    expect(choosePage(pages)).toBeNull();
    expect(choosePage(pages, "2")?.id).toBe("2");
    expect(choosePage([pages[0]!])?.id).toBe("1");
  });
});

describe("media and rendering", () => {
  it("publishes only public https media and refuses path traversal", async () => {
    expect(isPublishableMediaUrl("/admin/api/social/media/x.jpg")).toBe(false);
    expect(isPublishableMediaUrl("https://x.supabase.co/a.mp4")).toBe(true);
    await expect(readLocalMedia("../../.env.local")).resolves.toBeNull();
  });

  it("builds a 1080x1920 H.264 ffmpeg graph with transitions", () => {
    const scenes = [
      { seconds: 3, zoom: "none" as const, transition: "fade" },
      { seconds: 6, zoom: "in" as const, transition: "slideleft" },
      { seconds: 4, zoom: "out" as const, transition: "fade" },
    ];
    const args = ffmpegArgs(["a.png", "b.png", "c.png"], scenes, "out.mp4");
    const graph = args[args.indexOf("-filter_complex") + 1]!;
    expect(graph).toContain("s=1080x1920");
    expect(graph.match(/xfade/g)).toHaveLength(2);
    expect(args).toContain("libx264");
    expect(args.join(" ")).toContain("-ar 48000");
    expect(args.join(" ")).toContain("-g 60");
    expect(reelDurationSeconds(scenes)).toBeCloseTo(11.8);
  });
});
