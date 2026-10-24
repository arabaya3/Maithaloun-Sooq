import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const jobs = vi.hoisted(() => ({
  tick: vi.fn(async () => [{ job: "publish", status: "ok", summary: {} }]),
  daily: vi.fn(async () => []),
  run: vi.fn(),
}));

vi.mock("@/features/social/application/social-instance", async () => {
  const { isSocialManagerEnabled } =
    await import("@/features/social/application/social-factory");
  return {
    socialEnabled: () => isSocialManagerEnabled(process.env),
    socialJobs: jobs,
  };
});

const { GET } = await import("./route");

const secret = "cron-secret-0123456789abcdef0123456789";
const call = (run: string, authorization = `Bearer ${secret}`) =>
  GET(
    new Request(`http://localhost/api/cron/social?run=${run}`, {
      headers: { authorization },
    }),
  );

describe("social cron endpoint", () => {
  beforeEach(() => {
    vi.stubEnv("CRON_SECRET", secret);
    jobs.tick.mockClear();
    jobs.daily.mockClear();
    jobs.run.mockClear();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("runs nothing at all while SOCIAL_MANAGER is off", async () => {
    for (const value of [undefined, "", "off", "ON", "true"]) {
      vi.stubEnv("SOCIAL_MANAGER", value as string);
      for (const run of ["tick", "daily", "publish"]) {
        const response = await call(run);
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({
          ok: true,
          skipped: "disabled",
        });
      }
    }
    expect(jobs.tick).not.toHaveBeenCalled();
    expect(jobs.daily).not.toHaveBeenCalled();
    expect(jobs.run).not.toHaveBeenCalled();
  });

  it("refuses callers without the secret before anything else", async () => {
    vi.stubEnv("SOCIAL_MANAGER", "on");
    expect((await call("tick", "Bearer wrong")).status).toBe(401);
    expect((await call("tick", "")).status).toBe(401);
    vi.stubEnv("CRON_SECRET", "short");
    expect((await call("tick")).status).toBe(401);
    expect(jobs.tick).not.toHaveBeenCalled();
  });

  it("publishes at most one post per call when on", async () => {
    vi.stubEnv("SOCIAL_MANAGER", "on");
    expect((await call("tick")).status).toBe(200);
    expect(jobs.tick).toHaveBeenCalledWith(1);
    expect((await call("drop-table")).status).toBe(400);
  });
});
