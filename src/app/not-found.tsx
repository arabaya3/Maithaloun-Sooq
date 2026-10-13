import type { Metadata } from "next";

import { Link } from "@/i18n/link";
import { getMessages } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const m = await getMessages();
  return { title: m.meta.notFoundTitle };
}

export default async function NotFoundPage() {
  const { misc } = await getMessages();
  return (
    <main className="placeholder-page page-shell">
      <div className="placeholder-panel">
        <h1>{misc.notFoundHeading}</h1>
        <p>{misc.notFoundText}</p>
        <Link href="/">{misc.backToStore}</Link>
      </div>
    </main>
  );
}
