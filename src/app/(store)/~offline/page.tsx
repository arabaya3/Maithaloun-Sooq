import { WifiOff } from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";

import { appIcons } from "@/features/pwa/app-icons";
import { OfflineFavorites } from "@/features/favorites/offline-favorites";
import { Link } from "@/i18n/link";
import { getMessages } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const m = await getMessages();
  return { title: m.meta.offlineTitle };
}

export default async function OfflinePage() {
  const { misc } = await getMessages();
  return (
    <main className="placeholder-page page-shell">
      <div className="placeholder-panel">
        <Image
          className="offline-logo"
          src={appIcons.icon192}
          alt="MAYTHA MARKET"
          width={192}
          height={192}
          sizes="72px"
        />
        <WifiOff className="status-icon" aria-hidden="true" />
        <h1>{misc.offlineHeading}</h1>
        <p>{misc.offlineText}</p>
        <Link href="/">{misc.retry}</Link>
        <OfflineFavorites />
      </div>
    </main>
  );
}
