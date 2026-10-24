import { z } from "zod";

import {
  classifyMetaError,
  MetaApiError,
} from "@/features/social/domain/meta-errors";

import {
  DEFAULT_GRAPH_VERSION,
  requiredPageScopes,
  type FetchLike,
} from "./meta-graph-client";

export const OAUTH_STATE_COOKIE = "maytha_social_oauth";

/**
 * Facebook Login: the owner signs in on facebook.com and grants the Page permissions; we receive a
 * one-time code, never a password. The code becomes a long-lived user token, and that yields the
 * Page token, which does not expire while the owner keeps the app authorised.
 */
export interface MetaAppConfig {
  appId: string;
  appSecret: string;
  redirectUri: string;
  graphVersion?: string;
  fetch?: FetchLike;
  /** Facebook Login for Business: the configuration id replaces the scope list. */
  loginConfigId?: string;
}

export function loginDialogUrl(config: MetaAppConfig, state: string): string {
  const params = new URLSearchParams({
    client_id: config.appId,
    redirect_uri: config.redirectUri,
    state,
    response_type: "code",
    ...(config.loginConfigId
      ? { config_id: config.loginConfigId }
      : { scope: requiredPageScopes.join(",") }),
  });
  return `https://www.facebook.com/${config.graphVersion ?? DEFAULT_GRAPH_VERSION}/dialog/oauth?${params}`;
}

async function getJson<T>(
  config: MetaAppConfig,
  path: string,
  params: Record<string, string>,
  schema: z.ZodType<T>,
): Promise<T> {
  const fetcher = config.fetch ?? ((url, init) => fetch(url, init));
  const response = await fetcher(
    `https://graph.facebook.com/${config.graphVersion ?? DEFAULT_GRAPH_VERSION}/${path}?${new URLSearchParams(params)}`,
    { signal: AbortSignal.timeout(15_000) },
  );
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = (
      body as { error?: { code?: number; error_subcode?: number } } | null
    )?.error;
    throw new MetaApiError(
      classifyMetaError({
        httpStatus: response.status,
        code: error?.code,
        subcode: error?.error_subcode,
      }),
    );
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success)
    throw new MetaApiError({ kind: "unknown", code: null, subcode: null });
  return parsed.data;
}

export interface ManagedPage {
  id: string;
  name: string;
  accessToken: string;
}

export async function pagesFromLoginCode(
  config: MetaAppConfig,
  code: string,
): Promise<ManagedPage[]> {
  const tokenSchema = z.object({ access_token: z.string() });
  const shortLived = await getJson(
    config,
    "oauth/access_token",
    {
      client_id: config.appId,
      client_secret: config.appSecret,
      redirect_uri: config.redirectUri,
      code,
    },
    tokenSchema,
  );
  const longLived = await getJson(
    config,
    "oauth/access_token",
    {
      grant_type: "fb_exchange_token",
      client_id: config.appId,
      client_secret: config.appSecret,
      fb_exchange_token: shortLived.access_token,
    },
    tokenSchema,
  );
  const pages = await getJson(
    config,
    "me/accounts",
    {
      fields: "id,name,access_token",
      access_token: longLived.access_token,
    },
    z.object({
      data: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          access_token: z.string(),
        }),
      ),
    }),
  );
  return pages.data.map((page) => ({
    id: page.id,
    name: page.name,
    accessToken: page.access_token,
  }));
}

/** The configured Page when set, otherwise the only Page the owner manages; never a guess between several. */
export function choosePage(
  pages: readonly ManagedPage[],
  wantedPageId?: string,
): ManagedPage | null {
  if (wantedPageId)
    return pages.find((page) => page.id === wantedPageId) ?? null;
  return pages.length === 1 ? pages[0]! : null;
}
