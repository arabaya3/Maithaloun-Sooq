"use client";

import { Share, SquarePlus } from "lucide-react";

import { Sheet } from "@/shared/ui/sheet";

import type { InstallScope } from "./install-state";

const copy = {
  storefront: {
    title: "إضافة سوق ميثلون إلى الشاشة الرئيسية",
    steps: [
      "افتح زر المشاركة في المتصفح.",
      "اختر “إضافة إلى الشاشة الرئيسية”.",
      "اضغط “إضافة”.",
    ],
    other: "في متصفحات أخرى: افتح قائمة المتصفح ثم اختر “تثبيت التطبيق”.",
  },
  admin: {
    title: "تثبيت تطبيق الإدارة",
    steps: [
      "افتحي زر المشاركة.",
      "اختاري “إضافة إلى الشاشة الرئيسية”.",
      "اضغطي “إضافة”.",
    ],
    other:
      "على أندرويد: افتحي قائمة المتصفح ثم اختاري “تثبيت التطبيق” أو “إضافة إلى الشاشة الرئيسية”.",
  },
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
  const text = copy[scope];
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
