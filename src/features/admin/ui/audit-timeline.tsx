import type { AuditLogEntry } from "@/features/admin/application/audit-log-service";
import { auditEntityLabels } from "@/features/admin/domain/audit-labels";
import { formatAdminDateTime } from "@/features/admin/ui/format-admin-datetime";

type State = Record<string, string | number | boolean | null>;

function value(item: string | number | boolean | null): string {
  if (item === null) return "—";
  if (typeof item === "boolean") return item ? "نعم" : "لا";
  return String(item);
}

/** Before → after for each field the event recorded; audit states never hold secrets. */
function Changes({
  before,
  after,
}: {
  before: State | null;
  after: State | null;
}) {
  const keys = [
    ...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]),
  ];
  if (!keys.length) return null;
  return (
    <dl className="admin-audit-changes">
      {keys.map((key) => (
        <div key={key}>
          <dt dir="ltr">{key}</dt>
          <dd>
            {before && key in before ? (
              <>
                <bdi dir="ltr">{value(before[key]!)}</bdi> ←{" "}
              </>
            ) : null}
            <bdi dir="ltr">
              {after && key in after ? value(after[key]!) : "—"}
            </bdi>
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Audit events as a timeline: who did what to which record, and when. */
export function AuditTimeline({ entries }: { entries: AuditLogEntry[] }) {
  return (
    <ol className="admin-line-list admin-movement-timeline admin-audit-timeline">
      {entries.map((entry) => (
        <li key={entry.id} className="admin-line">
          <span className="admin-line-main">
            <strong>{entry.label}</strong>
            <small>
              {entry.actorName} · {formatAdminDateTime(entry.at)} ·{" "}
              {auditEntityLabels[entry.entityType] ?? entry.entityType}{" "}
              <bdi dir="ltr">{entry.entityId}</bdi>
            </small>
            <Changes before={entry.before} after={entry.after} />
          </span>
        </li>
      ))}
    </ol>
  );
}
