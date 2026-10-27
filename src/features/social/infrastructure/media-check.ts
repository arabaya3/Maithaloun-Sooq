import type { FetchLike } from "./meta-graph-client";

export type MediaProblem =
  | "MEDIA_NOT_PUBLIC"
  | "MEDIA_NOT_REACHABLE"
  | "MEDIA_WRONG_TYPE"
  | "MEDIA_TOO_LARGE";

const limits = {
  image: { types: ["image/jpeg", "image/png"], maxBytes: 4_000_000 },
  video: { types: ["video/mp4"], maxBytes: 1_000_000_000 },
} as const;

/**
 * Before anything is handed to Facebook or Make: the media must be a public https file that answers
 * without credentials, with the expected type and within Meta's size limits.
 */
export async function checkPublicMedia(
  url: string,
  kind: "image" | "video",
  fetcher: FetchLike = (input, init) => fetch(input, init),
): Promise<MediaProblem | null> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "MEDIA_NOT_PUBLIC";
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    /^(localhost|127\.|10\.|192\.168\.|169\.254\.)/.test(parsed.hostname)
  ) {
    return "MEDIA_NOT_PUBLIC";
  }
  let response: Response;
  try {
    response = await fetcher(url, {
      method: "HEAD",
      redirect: "follow",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return "MEDIA_NOT_REACHABLE";
  }
  if (!response.ok) return "MEDIA_NOT_REACHABLE";
  const type = response.headers.get("content-type")?.split(";")[0]?.trim();
  const limit = limits[kind];
  if (!type || !(limit.types as readonly string[]).includes(type)) {
    return "MEDIA_WRONG_TYPE";
  }
  const size = Number(response.headers.get("content-length"));
  if (Number.isFinite(size) && size > limit.maxBytes) return "MEDIA_TOO_LARGE";
  return null;
}
