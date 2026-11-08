"use client";

import { ListChecks } from "lucide-react";

import {
  ProductDescription,
  splitProductText,
} from "@/features/catalog/components/product-description";
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
  // A separate usage field wins only when the description holds no usage of its own.
  const usage = split.usage ?? (usageNotes?.trim() || null);
  return (
    <div className="product-info">
      <details className="product-info-section product-info-description">
        <summary>{m.catalog.descriptionTitle}</summary>
        <ProductDescription text={split.description} />
      </details>
      {usage ? (
        <details className="product-info-section product-info-usage">
          <summary>
            <ListChecks aria-hidden="true" />
            {m.catalog.usageTitle}
          </summary>
          <ProductDescription text={usage} />
        </details>
      ) : null}
    </div>
  );
}
