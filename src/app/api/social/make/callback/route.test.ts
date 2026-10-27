import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const service = vi.hoisted(() => ({
  confirmFromProvider: vi.fn(async () => "applied" as const),
}));

vi.mock("@/features/social/application/social-instance", async () => {
  const { isSocialManagerEnabled } =
    await import("@/features/social/application/social-factory");
  return {
    socialEnabled: () => isSocialManagerEnabled(process.env),
    socialService: service,
  };
});

const { POST } = await import("./route");

const SECRET = "make-callback-secret-0123456789abcdef";
const valid = {
  post_id: "4fbdcdc6-b22c-420b-bb74-515483382a49",
  idempotency_key: "b".repeat(64),
  status: "published",
  facebook_post_id: "61595987361563_42424",
};
const call = (body: unknown, key: string | null = SECRET) =>
  POST(
    new Request("http://localhost/api/social/make/callback", {
      method: "POST",
      headers: key ? { "x-maytha-callback-key": key } : {},
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );

describe("Make callback", () => {
  beforeEach(() => {
    vi.stubEnv("SOCIAL_MANAGER", "on");
    vi.stubEnv("MAKE_CALLBACK_SECRET", SECRET);
    service.confirmFromProvider.mockClear();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("does not exist while the manager is off or no secret is set", async () => {
    vi.stubEnv("SOCIAL_MANAGER", "off");
    expect((await call(valid)).status).toBe(404);
    vi.stubEnv("SOCIAL_MANAGER", "on");
    vi.stubEnv("MAKE_CALLBACK_SECRET", "short");
    expect((await call(valid)).status).toBe(404);
    expect(service.confirmFromProvider).not.toHaveBeenCalled();
  });

  it("refuses callers without the shared secret", async () => {
    expect((await call(valid, null)).status).toBe(401);
    expect(
      (await call(valid, "wrong-secret-0123456789abcdef012345")).status,
    ).toBe(401);
    expect(service.confirmFromProvider).not.toHaveBeenCalled();
  });

  it("refuses malformed reports", async () => {
    expect((await call("{oops")).status).toBe(400);
    expect((await call({ ...valid, post_id: "1; drop table" })).status).toBe(
      400,
    );
    expect((await call({ ...valid, status: "approved" })).status).toBe(400);
    expect((await call({ ...valid, idempotency_key: "short" })).status).toBe(
      400,
    );
    expect((await call("x".repeat(9_000))).status).toBe(413);
    expect(service.confirmFromProvider).not.toHaveBeenCalled();
  });

  it("passes a valid report to the service, which only settles posts it handed over", async () => {
    const response = await call(valid);
    expect(response.status).toBe(200);
    expect(service.confirmFromProvider).toHaveBeenCalledWith({
      postId: valid.post_id,
      idempotencyKey: valid.idempotency_key,
      status: "published",
      facebookPostId: "61595987361563_42424",
      error: undefined,
    });
  });
});
