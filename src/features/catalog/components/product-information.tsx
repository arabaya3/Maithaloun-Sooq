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
      <section
        className="product-info-section"
        aria-labelledby="description-title"
      >
        <h2 id="description-title">{m.catalog.descriptionTitle}</h2>
        <ProductDescription text={split.description} />
      </section>
      {usage ? (
        <section
          className="product-info-section product-info-usage"
          aria-labelledby="usage-title"
        >
          <h2 id="usage-title">
            <ListChecks aria-hidden="true" />
            {m.catalog.usageTitle}
          </h2>
          <ProductDescription text={usage} />
        </section>
      ) : null}
    </div>
  );
}
