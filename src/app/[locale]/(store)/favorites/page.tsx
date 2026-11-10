import { redirect } from "next/navigation";

import { localizePath } from "@/i18n/config";
import { getLocale } from "@/i18n/server";

export default async function FavoritesPage() {
  redirect(localizePath(await getLocale(), "/cart"));
}
