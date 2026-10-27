import { MAKE_PAYLOAD_SCHEMA } from "./make-payload";
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

export function contractProbe(): Record<string, unknown> {
  return {
    schema: MAKE_PAYLOAD_SCHEMA,
    postId: "00000000-0000-4000-8000-00000000c0de",
    idempotencyKey: "0".repeat(64),
    attempt: 1,
    contentType: INVALID_CONTENT_TYPE,
    caption: "contract test — must not be published",
    mediaUrl: null,
    coverUrl: null,
    pageId: null,
    callbackUrl: null,
  };
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
): Promise<number | null> {
  try {
    const response = await fetcher(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        ...headers,
      },
      body: JSON.stringify(contractProbe()),
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
    const invalid = await statusOf(fetcher, input.webhookUrl, {
      "x-make-apikey": input.apiKey,
    });
    checks.push({
      name: `authenticated request with contentType «${INVALID_CONTENT_TYPE}»`,
      expected: "422",
      status: invalid,
      passed: invalid === 422,
    });
  }
  return checks;
}
