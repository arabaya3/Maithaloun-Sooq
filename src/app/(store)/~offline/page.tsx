import { WifiOff } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

export default function OfflinePage() {
  return (
    <main className="placeholder-page page-shell">
      <div className="placeholder-panel">
        <Image
          className="offline-logo"
          src="/brand/maithaloun-symbol.png"
          alt="سوق ميثلون"
          width={360}
          height={285}
          sizes="72px"
        />
        <WifiOff className="status-icon" aria-hidden="true" />
        <h1>أنت غير متصل الآن</h1>
        <p>تحقق من اتصالك بالإنترنت، ثم حاول فتح الصفحة مرة أخرى.</p>
        <Link href="/">إعادة المحاولة</Link>
      </div>
    </main>
  );
}
