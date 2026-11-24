import { permanentRedirect } from "next/navigation";

import { localizePath } from "@/i18n/config";
import { getLocale } from "@/i18n/server";

// The storefront no longer has an offers section; offers still apply to prices, and the admin keeps
// managing them. Old links and bookmarks land on the home page instead of a 404.
export default async function OffersPage() {
  permanentRedirect(localizePath(await getLocale(), "/"));
}
