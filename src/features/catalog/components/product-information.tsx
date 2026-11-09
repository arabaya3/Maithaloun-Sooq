"use client";

import { ChevronDown, FileText, ListChecks, Truck } from "lucide-react";

import {
  ProductDescription,
  splitProductText,
} from "@/features/catalog/components/product-description";
import { ProductTrust } from "@/features/catalog/components/product-trust";
import { useI18n } from "@/i18n/i18n-provider";

/** Description and usage as separate, titled sections; the owner's wording is shown as written. */
export function ProductInformation({
  description,
  usageNotes,
}: {
  description: string | null | undefined;
  usageNotes?: string | null;
}) {
  const { m } = useI18n();
  const split = description
    ? splitProductText(description)
    : { description: m.catalog.descriptionPending, usage: null };
  const usage = usageNotes?.trim() || split.usage;
  return (
    <div className="product-info">
      <details className="product-info-section product-info-description">
        <summary>
          <FileText aria-hidden="true" />
          {m.catalog.descriptionTitle}
          <ChevronDown className="detail-section-chevron" aria-hidden="true" />
        </summary>
        <ProductDescription text={split.description} />
      </details>
      {usage ? (
        <details className="product-info-section product-info-usage">
          <summary>
            <ListChecks aria-hidden="true" />
            {m.catalog.usageTitle}
            <ChevronDown
              className="detail-section-chevron"
              aria-hidden="true"
            />
          </summary>
          <ProductDescription text={usage} />
        </details>
      ) : null}
      <details className="product-info-section">
        <summary>
          <Truck aria-hidden="true" />
          {m.catalog.trustLabel}
          <ChevronDown className="detail-section-chevron" aria-hidden="true" />
        </summary>
        <ProductTrust />
      </details>
    </div>
  );
}
