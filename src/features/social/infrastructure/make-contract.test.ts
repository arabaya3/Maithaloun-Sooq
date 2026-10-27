import { describe, expect, it, vi } from "vitest";

import {
  contractProbe,
  INVALID_CONTENT_TYPE,
  runMakeContract,
  webhookHost,
} from "./make-contract";
import { makeContentTypes } from "./make-payload";

const URL_ = "https://hook.eu1.make.com/secret-path-abc";
const KEY = "make-api-key-0123456789";

/** A stand-in for the configured scenario: API-key webhook, 422 for unsupported content. */
function scenario() {
  const seen: Array<{ key: string | undefined; contentType: unknown }> = [];
  const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
    const headers = init!.headers as Record<string, string>;
    const body = JSON.parse(String(init!.body));
    seen.push({ key: headers["x-make-apikey"], contentType: body.contentType });
    if (headers["x-make-apikey"] !== KEY)
      return new Response("", { status: 401 });
    if (!(makeContentTypes as readonly string[]).includes(body.contentType)) {
      return new Response("Unsupported content", { status: 422 });
    }
    return Response.json({ facebookObjectId: "61595987361563_12345" });
  });
  return { fetch, seen };
}

describe("Make contract test", () => {
  it("can never publish: its only authenticated request has an invalid contentType", async () => {
    const probe = contractProbe();
    expect(makeContentTypes).not.toContain(probe.contentType);
    expect(probe.contentType).toBe(INVALID_CONTENT_TYPE);
    expect(probe.mediaUrl).toBeNull();
    const { fetch, seen } = scenario();
    const checks = await runMakeContract({
      webhookUrl: URL_,
      apiKey: KEY,
      scenarioActive: true,
      fetch,
    });
    expect(checks.map((check) => [check.status, check.passed])).toEqual([
      [401, true],
      [401, true],
      [422, true],
    ]);
    expect(
      seen.every((call) => call.contentType === INVALID_CONTENT_TYPE),
    ).toBe(true);
  });

  it("rejects an unauthenticated or wrong-key webhook as a failure if the scenario lets it through", async () => {
    const open = vi.fn(async () => new Response("Accepted"));
    const checks = await runMakeContract({
      webhookUrl: URL_,
      apiKey: KEY,
      scenarioActive: false,
      fetch: open,
    });
    expect(checks).toHaveLength(2);
    expect(checks.every((check) => !check.passed)).toBe(true);
  });

  it("does not send the authenticated probe to an inactive scenario", async () => {
    const { fetch, seen } = scenario();
    await runMakeContract({
      webhookUrl: URL_,
      apiKey: KEY,
      scenarioActive: false,
      fetch,
    });
    expect(seen.some((call) => call.key === KEY)).toBe(false);
  });

  it("never reveals the webhook path or the key", async () => {
    expect(webhookHost(URL_)).toBe("hook.eu1.make.com");
    const { fetch } = scenario();
    const checks = await runMakeContract({
      webhookUrl: URL_,
      apiKey: KEY,
      scenarioActive: true,
      fetch,
    });
    const report = JSON.stringify(checks);
    expect(report).not.toContain("secret-path");
    expect(report).not.toContain(KEY);
  });
});
