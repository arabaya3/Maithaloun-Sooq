"use client";

import { Check } from "lucide-react";

import {
  selectionLabel,
  valueStates,
  type OptionSelection,
  type ProductOption,
  type SelectableVariant,
} from "@/features/catalog/domain/product-options";
import { useI18n } from "@/i18n/i18n-provider";

export function OptionSelectors({
  options,
  variants,
  selection,
  onSelect,
}: {
  options: readonly ProductOption[];
  variants: readonly SelectableVariant[];
  selection: OptionSelection;
  onSelect: (optionId: string, valueId: string) => void;
}) {
  const { m, locale } = useI18n();
  const states = valueStates(options, variants, selection);
  return (
    <div className="option-selectors">
      <p className="sr-only" aria-live="polite">
        {selectionLabel(options, selection)}
      </p>
      {options.map((option) => {
        return (
          <fieldset key={option.id} className="variant-selector">
            <legend className="variant-selector-label">
              {option.nameAr}
              <span className="variant-selector-chosen">
                {" · "}{m.catalog.optionCount(option.values.length)}
              </span>
            </legend>
            <div
              className="variant-selector-options"
              role="radiogroup"
              aria-label={option.nameAr}
            >
              {option.values.map((value) => {
                const state = states[option.id]?.[value.id] ?? "impossible";
                const selected = selection[option.id] === value.id;
                return (
                  <button
                    key={value.id}
                    type="button"
                    role="radio"
                    className="variant-option"
                    aria-checked={selected}
                    aria-label={value.valueAr}
                    data-selected={selected}
                    data-state={state}
                    disabled={state === "impossible" || state === "unavailable"}
                    onClick={() => onSelect(option.id, value.id)}
                  >
                    <bdi dir="auto">
                      {locale === "ar"
                        ? value.valueAr.replace(/\s*\([A-Za-z][^()]*\)\s*$/, "").replace(/^رائحة\s+/, "") || value.valueAr
                        : value.valueAr}
                    </bdi>
                    {selected ? <Check className="variant-option-check" aria-hidden="true" /> : null}
                    {state === "unavailable" ? (
                      <span className="variant-option-note">
                        {m.catalog.optionUnavailable}
                      </span>
                    ) : null}
                    {state === "adjusts" ? (
                      <span className="sr-only">{m.catalog.optionAdjusts}</span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </fieldset>
        );
      })}
    </div>
  );
}
