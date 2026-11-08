"use client";

import { ArrowRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { Link } from "@/i18n/link";

export function ProductBackLink({ label }: { label: string }) {
  const router = useRouter();

  useEffect(() => {
    if (sessionStorage.getItem("maytha:product-navigation") !== location.pathname) return;
    sessionStorage.removeItem("maytha:product-navigation");
    history.replaceState({ ...history.state, maythaProductBack: true }, "");
  });

  return (
    <Link
      className="back-link"
      href="/#catalog"
      onNavigate={(event) => {
        if (!history.state?.maythaProductBack) return;
        event.preventDefault();
        router.back();
      }}
    >
      <ArrowRight className="rtl-flip" aria-hidden="true" />
      {label}
    </Link>
  );
}
