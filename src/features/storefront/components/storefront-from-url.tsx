"use client";

import { useSearchParams } from "next/navigation";
import type { ComponentProps } from "react";

import { ALL_CATEGORIES } from "@/features/catalog/domain/category";
import { parseProductSort } from "@/features/catalog/domain/product-sort";

import { Storefront } from "./storefront";

type StorefrontProps = ComponentProps<typeof Storefront>;

/**
 * The home page is served from the static cache, so its ?category, ?q and ?sort are read in the
 * browser. The cached HTML shows the unfiltered store (the Suspense fallback) until this takes over.
 */
export function StorefrontFromUrl(
  props: Omit<
    StorefrontProps,
    "initialCategory" | "initialQuery" | "initialSort"
  >,
) {
  const params = useSearchParams();
  // Unknown, hidden or archived codes fall back to every product.
  const initialCategory =
    props.categories.find((item) => item.code === params.get("category"))
      ?.code ?? ALL_CATEGORIES;
  const initialQuery = (params.get("q") ?? "").slice(0, 100);
  return (
    <Storefront
      {...props}
      initialCategory={initialCategory}
      initialQuery={initialQuery}
      initialSort={parseProductSort(params.get("sort") ?? undefined)}
    />
  );
}
