import { MAKE_PAYLOAD_SCHEMA, makeContentTypes } from "./make-payload";
import type { FetchLike } from "./meta-graph-client";

/**
 * A live check of the Make scenario's contract that can never publish: requests without or with a
 * wrong API key (must be refused), and one authenticated request whose contentType is invalid
 * (must be answered 422 before the Facebook module). Output names the webhook host only.
 */
export interface ContractCheck {
  name: string;
  expected: string;
  status: number | null;
  passed: boolean;
}

export const INVALID_CONTENT_TYPE = "contract-test-invalid";

/**
 * The probes: the scenario's required fields with an unsupported contentType and no media, so the
 * scenario's fallback route must answer 422 before any Facebook module. «minimal» omits every
 * optional field; «full» adds the optional non-media fields.
 */
export function contractProbe(
  variant: "minimal" | "full" = "minimal",
): Record<string, unknown> {
  const probe: Record<string, unknown> = {
    postId: "00000000-0000-4000-8000-00000000c0de",
    idempotencyKey: "0".repeat(64),
    contentType: INVALID_CONTENT_TYPE,
    caption: "contract test — must not be published",
  };
  if (variant === "full") {
    probe.schema = MAKE_PAYLOAD_SCHEMA;
    probe.attempt = 1;
  }
  return probe;
}

/** A probe can never be publishable: unsupported type and no media of any kind. */
export function isUnpublishableProbe(probe: Record<string, unknown>): boolean {
  return (
    !(makeContentTypes as readonly unknown[]).includes(probe.contentType) &&
    !("mediaUrl" in probe) &&
    !("coverUrl" in probe)
  );
}

export function webhookHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "invalid-url";
  }
}

async function statusOf(
  fetcher: FetchLike,
  url: string,
  headers: Record<string, string>,
  probe: Record<string, unknown> = contractProbe(),
): Promise<number | null> {
  if (!isUnpublishableProbe(probe)) throw new Error("PROBE_COULD_PUBLISH");
  try {
    const response = await fetcher(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        ...headers,
      },
      body: JSON.stringify(probe),
      signal: AbortSignal.timeout(20_000),
    });
    await response.text().catch(() => "");
    return response.status;
  } catch {
    return null;
  }
}

export async function runMakeContract(input: {
  webhookUrl: string;
  apiKey: string;
  /** The authenticated probe is sent only to an active scenario (an inactive one queues it). */
  scenarioActive: boolean;
  fetch?: FetchLike;
}): Promise<ContractCheck[]> {
  const fetcher = input.fetch ?? ((url, init) => fetch(url, init));
  const refused = (status: number | null) => status === 401 || status === 403;
  const checks: ContractCheck[] = [];
  const noKey = await statusOf(fetcher, input.webhookUrl, {});
  checks.push({
    name: "request without x-make-apikey",
    expected: "401/403",
    status: noKey,
    passed: refused(noKey),
  });
  const wrongKey = await statusOf(fetcher, input.webhookUrl, {
    "x-make-apikey": `wrong-${input.apiKey.length}-contract-test`,
  });
  checks.push({
    name: "request with a wrong x-make-apikey",
    expected: "401/403",
    status: wrongKey,
    passed: refused(wrongKey),
  });
  if (input.scenarioActive) {
    for (const variant of ["full", "minimal"] as const) {
      const status = await statusOf(
        fetcher,
        input.webhookUrl,
        { "x-make-apikey": input.apiKey },
        contractProbe(variant),
      );
      checks.push({
        name:
          variant === "full"
            ? `valid key, unsupported contentType «${INVALID_CONTENT_TYPE}»`
            : "valid key, optional fields omitted, unsupported contentType",
        expected: "422",
        status,
        passed: status === 422,
      });
    }
  }
  return checks;
}
