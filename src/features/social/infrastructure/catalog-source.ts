import {
  publicCatalogSchema,
  toSocialCatalog,
  type PublicCatalog,
  type SocialCatalog,
} from "@/features/social/domain/social-catalog";

export type CatalogSource = () => Promise<SocialCatalog>;

export class CatalogUnavailableError extends Error {
  constructor() {
    super("CATALOG_UNAVAILABLE");
    this.name = "CatalogUnavailableError";
  }
}

export function parsePublicCatalog(body: unknown): PublicCatalog {
  const parsed = publicCatalogSchema.safeParse(body);
  if (!parsed.success) throw new CatalogUnavailableError();
  return parsed.data;
}

/**
 * The worker reads the store's own public catalog endpoint: the same published products and
 * prices a customer sees, and nothing a customer could not see.
 */
export function httpCatalogSource(
  origin: string,
  fetcher: typeof fetch = fetch,
): CatalogSource {
  return async () => {
    let response: Response;
    try {
      response = await fetcher(`${origin.replace(/\/$/, "")}/api/v1/catalog`, {
        headers: { Accept: "application/json", "Accept-Language": "ar" },
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new CatalogUnavailableError();
    }
    if (!response.ok) throw new CatalogUnavailableError();
    return toSocialCatalog(parsePublicCatalog(await response.json()));
  };
}
