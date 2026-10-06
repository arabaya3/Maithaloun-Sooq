import {
  formatQuantity,
  unitsToMilli,
} from "@/features/inventory/domain/quantity";
import { formatIls } from "@/shared/lib/format-currency";

import type { OrderStatus } from "./order-status";

export interface ImpactLine {
  name: string;
  /** Pieces the line takes from stock (packs × pieces per pack). */
  pieces: number;
  tracked: boolean;
  reservation: "active" | "released" | "fulfilled" | null;
  availableMilli: number | null;
}

export interface StatusImpact {
  stock: string[];
  money: string;
  /** The server will refuse this change (for example, not enough stock to reserve). */
  blocked: boolean;
}

const pieces = (count: number) => formatQuantity(unitsToMilli(count));

/**
 * What a status change does to stock and money, shown before the owner commits it.
 * Mirrors the transaction in order-inventory: confirmed reserves, delivered deducts what was
 * reserved, cancelled releases it; the other steps leave stock alone. Orders are paid on delivery.
 */
export function statusImpact(
  next: OrderStatus,
  lines: readonly ImpactLine[],
  totalAgorot: number | null,
): StatusImpact {
  const tracked = lines.filter((line) => line.tracked);
  const untracked = lines.filter((line) => !line.tracked);
  const untrackedNote = untracked.length
    ? [
        `${untracked.map((line) => `«${line.name}»`).join("، ")} غير متتبَّع في المخزون، فلا يتغير.`,
      ]
    : [];
  const total = totalAgorot === null ? "قيمة الطلب" : formatIls(totalAgorot);

  if (next === "confirmed") {
    const short = tracked.filter(
      (line) => (line.availableMilli ?? 0) < unitsToMilli(line.pieces),
    );
    return {
      stock: [
        ...tracked.map((line) =>
          short.includes(line)
            ? `«${line.name}»: يحتاج ${pieces(line.pieces)} والمتوفر ${formatQuantity(line.availableMilli ?? 0)} فقط.`
            : `يُحجز ${pieces(line.pieces)} من «${line.name}» (لا يُخصم قبل التسليم).`,
        ),
        ...untrackedNote,
      ],
      money: "لا يُحصَّل أي مبلغ الآن؛ الدفع عند التسليم.",
      blocked: short.length > 0,
    };
  }
  if (next === "delivered") {
    return {
      stock: [
        ...tracked.map(
          (line) =>
            `يُخصم ${pieces(line.pieces)} من «${line.name}» نهائياً وتُحسب تكلفته.`,
        ),
        ...untrackedNote,
      ],
      money: `يُحصَّل ${total} من الزبون عند التسليم ويدخل في مبيعات اليوم.`,
      blocked: false,
    };
  }
  if (next === "cancelled") {
    const reserved = tracked.filter((line) => line.reservation === "active");
    return {
      stock: reserved.length
        ? reserved.map(
            (line) =>
              `يُفك حجز ${pieces(line.pieces)} من «${line.name}» ويعود متاحاً للبيع.`,
          )
        : ["لا يوجد حجز لهذا الطلب، فلا يتغير المخزون."],
      money: "لا يوجد مبلغ مدفوع لإرجاعه؛ الطلب بالدفع عند التسليم.",
      blocked: false,
    };
  }
  return {
    stock: [
      tracked.some((line) => line.reservation === "active")
        ? "لا يتغير المخزون؛ تبقى الكميات محجوزة لهذا الطلب."
        : "لا يتغير المخزون.",
    ],
    money: "لا يتغير شيء في المبلغ.",
    blocked: false,
  };
}
