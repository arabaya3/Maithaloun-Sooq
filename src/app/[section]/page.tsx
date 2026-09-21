import { ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

const sections = {
  categories: {
    title: "الفئات",
    description: "ستتوفر صفحة استعراض الفئات الكاملة في مرحلة لاحقة.",
  },
  offers: {
    title: "العروض",
    description: "لا توجد عروض منشورة حالياً. عد لاحقاً للاطلاع على الجديد.",
  },
  account: {
    title: "حسابي",
    description: "تسجيل الحسابات غير متاح في النسخة الحالية من المتجر.",
  },
} as const;

type SectionKey = keyof typeof sections;

function getSection(value: string) {
  return value in sections ? sections[value as SectionKey] : null;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ section: string }>;
}): Promise<Metadata> {
  const section = getSection((await params).section);
  return { title: section?.title ?? "الصفحة غير موجودة" };
}

export default async function PlaceholderPage({
  params,
}: {
  params: Promise<{ section: string }>;
}) {
  const section = getSection((await params).section);
  if (!section) notFound();

  return (
    <main className="placeholder-page page-shell">
      <div className="placeholder-panel">
        <span className="eyebrow">سوق ميثلون</span>
        <h1>{section.title}</h1>
        <p>{section.description}</p>
        <Link href="/">
          <ArrowRight aria-hidden="true" />
          العودة إلى الرئيسية
        </Link>
      </div>
    </main>
  );
}
