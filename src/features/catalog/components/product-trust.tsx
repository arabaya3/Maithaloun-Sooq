import { BadgeCheck, Banknote, Truck } from "lucide-react";

import { FREE_DELIVERY_THRESHOLD_AGOROT } from "@/features/delivery/delivery-policy";
import { formatIls } from "@/shared/lib/format-currency";

export function ProductTrust() {
  return (
    <ul className="product-trust" aria-label="التوصيل والدفع">
      <li>
        <Truck aria-hidden="true" />
        توصيل داخل ميثلون، مجاني من {formatIls(FREE_DELIVERY_THRESHOLD_AGOROT)}
      </li>
      <li>
        <Banknote aria-hidden="true" />
        الدفع نقداً عند الاستلام
      </li>
      <li>
        <BadgeCheck aria-hidden="true" />
        منتجات أصلية
      </li>
    </ul>
  );
}
