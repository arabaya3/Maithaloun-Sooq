"use client";

import { Share, SquarePlus } from "lucide-react";

import { useI18n } from "@/i18n/i18n-provider";
import { Sheet } from "@/shared/ui/sheet";

import type { InstallScope } from "./install-state";

// The admin app is Arabic-only; the storefront copy comes from the pwa messages.
const adminCopy = {
  title: "تثبيت تطبيق الإدارة",
  steps: [
    "افتحي زر المشاركة.",
    "اختاري “إضافة إلى الشاشة الرئيسية”.",
    "اضغطي “إضافة”.",
  ],
  other:
    "على أندرويد: افتحي قائمة المتصفح ثم اختاري “تثبيت التطبيق” أو “إضافة إلى الشاشة الرئيسية”.",
} as const;

const stepIcons = [Share, SquarePlus, null] as const;

export function InstallInstructions({
  scope,
  open,
  onClose,
}: {
  scope: InstallScope;
  open: boolean;
  onClose: () => void;
}) {
  const { pwa } = useI18n().m;
  const text =
    scope === "admin"
      ? adminCopy
      : { title: pwa.stepsTitle, steps: pwa.steps, other: pwa.stepsOther };
  return (
    <Sheet open={open} onClose={onClose} title={text.title}>
      <ol className="install-steps">
        {text.steps.map((step, index) => {
          const Icon = stepIcons[index];
          return (
            <li key={step}>
              <span className="install-step-number" aria-hidden="true">
                {index + 1}
              </span>
              <span>{step}</span>
              {Icon ? <Icon size={18} aria-hidden="true" /> : null}
            </li>
          );
        })}
      </ol>
      <p className="install-note">{text.other}</p>
    </Sheet>
  );
}
