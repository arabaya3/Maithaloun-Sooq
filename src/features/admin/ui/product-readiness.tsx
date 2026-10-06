import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  type LucideIcon,
} from "lucide-react";

import type {
  PublicationCheck,
  ReadinessStep,
} from "@/features/admin/application/catalog-authoring-service";

type State = "done" | "todo" | "ready" | "optional";

const stateIcon: Record<State, LucideIcon> = {
  done: CheckCircle2,
  todo: AlertTriangle,
  ready: CheckCircle2,
  optional: CircleDashed,
};

const stateLabel: Record<State, string> = {
  done: "مكتمل",
  todo: "يحتاج إكمال",
  ready: "جاهز للنشر",
  optional: "اختياري",
};

/**
 * The product flow of spec §8 as a checklist, read from the same server publish check that blocks
 * publishing; nothing here decides readiness on its own.
 */
export function ProductReadiness({
  check,
  publication,
  hasOptions,
}: {
  check: PublicationCheck;
  publication: "draft" | "published" | "hidden";
  hasOptions: boolean;
}) {
  const issuesFor = (step: ReadinessStep) =>
    check.issues.filter((issue) => issue.step === step);
  const rows: Array<{
    id: string;
    label: string;
    href: string;
    state: State;
    note?: string;
    issues: string[];
  }> = [
    {
      id: "identity",
      label: "الاسم والقسم والسعر",
      href: "#overview",
      state: issuesFor("identity").length ? "todo" : "done",
      issues: issuesFor("identity").map((issue) => issue.message),
    },
    {
      id: "variants",
      label: hasOptions ? "الخيارات والأصناف" : "الأصناف",
      href: hasOptions ? "#variants" : "#overview",
      state: issuesFor("variants").length ? "todo" : "done",
      issues: issuesFor("variants").map((issue) => issue.message),
    },
    {
      id: "images",
      label: "الصور",
      href: hasOptions ? "#variants" : "#overview",
      state: issuesFor("images").length ? "todo" : "done",
      note: check.acceptedPlaceholder
        ? "صورة مؤقتة: يمكن النشر بها بعد تأكيدك، والأفضل إضافة صورة حقيقية."
        : undefined,
      issues: issuesFor("images").map((issue) => issue.message),
    },
    {
      id: "selling-units",
      label: "طرق البيع",
      href: "#selling-units",
      state: issuesFor("selling_units").length ? "todo" : "done",
      issues: issuesFor("selling_units").map((issue) => issue.message),
    },
    {
      id: "stock",
      label: "المخزون الافتتاحي",
      href: "#inventory",
      state: "optional",
      note: "عند إدخال كمية افتتاحية تكون التكلفة مطلوبة.",
      issues: [],
    },
    {
      id: "publish",
      label: "المراجعة والنشر",
      href: "#publication",
      state:
        publication === "published" && check.ready
          ? "done"
          : check.ready
            ? "ready"
            : "todo",
      note:
        publication === "published"
          ? check.ready
            ? "منشور ويظهر للزبائن."
            : "منشور لكن ينقصه ما في الأعلى."
          : check.ready
            ? "جاهز للنشر. الخادم يعيد كل الفحوص عند النشر."
            : "يُفتح النشر بعد إكمال النقاط في الأعلى.",
      issues: [],
    },
  ];
  const required = rows.filter((row) => row.state !== "optional");
  const done = required.filter((row) => row.state !== "todo").length;

  return (
    <section className="admin-readiness" aria-labelledby="readiness-title">
      <div className="admin-readiness-head">
        <h2 id="readiness-title">جاهزية المنتج</h2>
        <p className="admin-muted">
          {done} من {required.length} مكتملة
        </p>
      </div>
      <ol className="admin-readiness-list">
        {rows.map((row) => {
          const Icon = stateIcon[row.state];
          return (
            <li key={row.id} data-state={row.state}>
              <Icon size={20} aria-hidden="true" />
              <div>
                <a href={row.href}>{row.label}</a>
                <span className="admin-readiness-state">
                  {stateLabel[row.state]}
                </span>
                {row.note ? <p className="admin-muted">{row.note}</p> : null}
                {row.issues.length ? (
                  <ul>
                    {row.issues.map((issue) => (
                      <li key={issue}>{issue}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
