import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AdminActor } from "@/features/admin/domain/admin-actor";

const mocks = vi.hoisted(() => ({
  actor: null as AdminActor | null,
  allowed: true,
  run: vi.fn(async () => ({ reference: "ref", answers: [] })),
  context: vi.fn(),
}));

vi.mock("@/features/admin/auth/authorize-admin-api", () => ({
  authorizeAdminApi: vi.fn(async (_request: Request, mutation: boolean) =>
    mutation ? mocks.actor : null,
  ),
}));
vi.mock("@/features/admin/auth/admin-rate-limit", () => ({
  allowAdminRequest: vi.fn(async () => mocks.allowed),
}));
vi.mock("@/features/assistant/application/smoke-test-service", () => ({
  runAssistantSmokeTest: mocks.run,
}));
vi.mock("@/features/assistant/application/assistant-access", () => ({
  assistantToolContext: mocks.context,
}));
vi.mock("@/features/admin/application/admin-services", () => ({
  assistantConversations: {},
}));
vi.mock("@/server/db/db", () => ({ db: {} }));

import { POST } from "./route";

const owner = {
  id: "o",
  role: "owner",
  active: true,
} as unknown as AdminActor;
const operator = { ...owner, role: "operator" } as AdminActor;
const request = () =>
  new Request("http://localhost/admin/api/assistant/smoke", {
    method: "POST",
  });

describe("assistant smoke route", () => {
  beforeEach(() => {
    vi.stubEnv("ASSISTANT_SMOKE_TEST", "on");
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    mocks.actor = owner;
    mocks.allowed = true;
    mocks.run.mockClear();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("is not found while the flag is off, even for the owner", async () => {
    vi.stubEnv("ASSISTANT_SMOKE_TEST", "");
    expect((await POST(request())).status).toBe(404);
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it("rejects anonymous or cross-origin callers and non-owners", async () => {
    mocks.actor = null;
    expect((await POST(request())).status).toBe(401);
    mocks.actor = operator;
    expect((await POST(request())).status).toBe(403);
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it("is rate-limited and needs a configured model", async () => {
    mocks.allowed = false;
    expect((await POST(request())).status).toBe(429);
    mocks.allowed = true;
    vi.stubEnv("OPENAI_API_KEY", "");
    expect((await POST(request())).status).toBe(503);
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it("runs in read mode with no-store headers for the owner", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.run).toHaveBeenCalledTimes(1);
    const contextFactory = (
      mocks.run.mock.calls[0] as unknown as [
        unknown,
        unknown,
        (id: string) => unknown,
      ]
    )[2];
    contextFactory("conversation");
    expect(mocks.context).toHaveBeenCalledWith(owner, "conversation", "read");
  });
});
