"use client";

import {
  valueStates,
  type OptionSelection,
  type ProductOption,
  type SelectableVariant,
} from "@/features/catalog/domain/product-options";

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
  const states = valueStates(options, variants, selection);
  return (
    <div className="option-selectors">
      {options.map((option) => {
        const chosen = option.values.find(
          (value) => value.id === selection[option.id],
        );
        return (
          <fieldset key={option.id} className="variant-selector">
            <legend className="variant-selector-label">
              {option.nameAr}
              {chosen ? (
                <span className="variant-selector-chosen">
                  : {chosen.valueAr}
                </span>
              ) : null}
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
                    data-selected={selected}
                    data-state={state}
                    disabled={state === "impossible"}
                    onClick={() => onSelect(option.id, value.id)}
                  >
                    {value.valueAr}
                    {state === "unavailable" ? (
                      <span className="variant-option-note">غير متوفر</span>
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
