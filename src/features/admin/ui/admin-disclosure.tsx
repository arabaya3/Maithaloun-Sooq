import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";

/** Optional detail stays mounted so reopening it preserves form edits. */
export function AdminDisclosure({
  title,
  children,
  defaultOpen = false,
  id,
  className = "",
}: {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
  id?: string;
  className?: string;
}) {
  return (
    <section
      className={`admin-panel admin-disclosure-panel ${className}`}
      aria-label={title}
    >
      <details className="admin-disclosure" open={defaultOpen} id={id}>
        <summary>
          <h2>{title}</h2>
          <ChevronDown size={18} aria-hidden="true" />
        </summary>
        <div className="admin-disclosure-body">{children}</div>
      </details>
    </section>
  );
}
