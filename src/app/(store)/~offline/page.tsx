import { WifiOff } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

import { appIcons } from "@/features/pwa/app-icons";
import { OfflineFavorites } from "@/features/favorites/offline-favorites";

export default function OfflinePage() {
  return (
    <main className="placeholder-page page-shell">
      <div className="placeholder-panel">
        <Image
          className="offline-logo"
          src={appIcons.icon192}
          alt="MAYTHA"
          width={192}
          height={192}
          sizes="72px"
        />
        <WifiOff className="status-icon" aria-hidden="true" />
        <h1>أنت غير متصل الآن</h1>
        <p>تحقق من اتصالك بالإنترنت، ثم حاول فتح الصفحة مرة أخرى.</p>
        <Link href="/">إعادة المحاولة</Link>
        <OfflineFavorites />
      </div>
    </main>
  );
}
