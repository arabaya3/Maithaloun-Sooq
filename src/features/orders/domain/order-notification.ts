import { formatIls } from "@/shared/lib/format-currency";

export type OrderNotificationInput = {
  customerName: string;
  totalAgorot: number;
  channel: "web" | "whatsapp";
  lines: readonly { name: string; quantity: number }[];
};

const TITLE_MAX = 120;
const BODY_MAX = 240;

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

function piecesLabel(count: number): string {
  if (count === 1) return "قطعة واحدة";
  if (count === 2) return "قطعتين";
  if (count <= 10) return `${count} قطع`;
  return `${count} قطعة`;
}

/** Push/inbox text for a new order: who, how much, and what, readable at a glance on a lock screen. */
export function orderCreatedNotification(input: OrderNotificationInput): {
  title: string;
  body: string;
} {
  const name = input.customerName.trim().split(/\s+/)[0] || "زبون";
  const pieces = input.lines.reduce((sum, line) => sum + line.quantity, 0);
  const first = input.lines[0]?.name.split(" — ")[0]?.trim() ?? "";
  const others = input.lines.length - 1;
  const items = !first
    ? ""
    : others > 0
      ? `${first} و${others === 1 ? "صنف آخر" : `${others} أصناف أخرى`}`
      : first;
  const channel = input.channel === "whatsapp" ? "عبر واتساب" : "من الموقع";

  return {
    title: clip(`طلب جديد · ${formatIls(input.totalAgorot)}`, TITLE_MAX),
    body: clip(
      [`${name} · ${piecesLabel(pieces)} · ${channel}`, items]
        .filter(Boolean)
        .join("\n"),
      BODY_MAX,
    ),
  };
}
