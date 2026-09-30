import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  CircleDashed,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";

import { formatQuantity } from "@/features/inventory/domain/quantity";
import {
  stockUnitLabels,
  type StockUnit,
} from "@/features/inventory/domain/stock-constants";
import {
  stockStatusLabels,
  type StockStatus,
} from "@/features/inventory/domain/stock-status";
import { formatIls } from "@/shared/lib/format-currency";

export function Money({ agorot }: { agorot: number }) {
  return (
    <bdi dir="ltr" className="admin-num">
      {formatIls(agorot)}
    </bdi>
  );
}

export function Quantity({ milli, unit }: { milli: number; unit?: StockUnit }) {
  return (
    <span className="admin-quantity">
      <bdi dir="ltr" className="admin-num">
        {formatQuantity(milli)}
      </bdi>
      {unit ? ` ${stockUnitLabels[unit]}` : null}
    </span>
  );
}

export type PillTone = "ok" | "warn" | "danger" | "neutral" | "info";

// Every status carries an icon and a label, so meaning never depends on colour.
export function StatusPill({
  tone,
  Icon,
  children,
}: {
  tone: PillTone;
  Icon: LucideIcon;
  children: ReactNode;
}) {
  return (
    <span className={`admin-pill admin-pill--${tone}`}>
      <Icon size={14} aria-hidden="true" />
      {children}
    </span>
  );
}

const stockPill: Record<
  StockStatus | "untracked",
  { tone: PillTone; Icon: LucideIcon; label: string }
> = {
  ok: { tone: "ok", Icon: CheckCircle2, label: stockStatusLabels.ok },
  low: { tone: "warn", Icon: AlertTriangle, label: stockStatusLabels.low },
  out: { tone: "danger", Icon: XCircle, label: stockStatusLabels.out },
  untracked: { tone: "neutral", Icon: CircleDashed, label: "غير متتبَّع" },
};

export function StockStatusPill({
  status,
}: {
  status: StockStatus | "untracked";
}) {
  const pill = stockPill[status];
  return (
    <StatusPill tone={pill.tone} Icon={pill.Icon}>
      {pill.label}
    </StatusPill>
  );
}

export function PageHeader({
  title,
  lede,
  back,
  actions,
}: {
  title: string;
  lede?: ReactNode;
  back?: { href: string; label: string };
  actions?: ReactNode;
}) {
  return (
    <header className="admin-page-header">
      <div>
        {back ? (
          <Link href={back.href} prefetch={false} className="admin-back-link">
            <ArrowRight size={16} aria-hidden="true" />
            {back.label}
          </Link>
        ) : null}
        <h1>{title}</h1>
        {lede ? <p className="admin-lede">{lede}</p> : null}
      </div>
      {actions ? <div className="admin-page-header-meta">{actions}</div> : null}
    </header>
  );
}

export function EmptyState({
  Icon,
  title,
  children,
}: {
  Icon: LucideIcon;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="admin-empty-state">
      <Icon size={28} aria-hidden="true" />
      <p className="admin-empty-state-title">{title}</p>
      {children}
    </div>
  );
}
