"use client";

import { BadgeCheck, Banknote, Truck } from "lucide-react";

import { FREE_DELIVERY_THRESHOLD_AGOROT } from "@/features/delivery/delivery-policy";
import { useI18n } from "@/i18n/i18n-provider";
import { formatIls } from "@/shared/lib/format-currency";

export function ProductTrust() {
  const { m } = useI18n();
  return (
    <ul className="product-trust" aria-label={m.catalog.trustLabel}>
      <li>
        <Truck aria-hidden="true" />
        {m.catalog.trustDelivery(formatIls(FREE_DELIVERY_THRESHOLD_AGOROT))}
      </li>
      <li>
        <Banknote aria-hidden="true" />
        {m.catalog.trustCash}
      </li>
      <li>
        <BadgeCheck aria-hidden="true" />
        {m.catalog.trustBrands}
      </li>
    </ul>
  );
}
