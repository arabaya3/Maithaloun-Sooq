import { WifiOff } from "lucide-react";
import Link from "next/link";

export default function OfflinePage() {
  return (
    <main className="placeholder-page page-shell">
      <div className="placeholder-panel">
        <WifiOff className="status-icon" aria-hidden="true" />
        <h1>أنت غير متصل الآن</h1>
        <p>تحقق من اتصالك بالإنترنت، ثم حاول فتح الصفحة مرة أخرى.</p>
        <Link href="/">إعادة المحاولة</Link>
      </div>
    </main>
  );
}
