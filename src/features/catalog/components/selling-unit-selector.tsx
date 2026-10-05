"use client";

import { useRef, type KeyboardEvent } from "react";

import {
  offerForSellingUnit,
  priceSellingUnit,
  type VariantOffer,
} from "@/features/catalog/domain/offer-pricing";
import {
  isSellingUnitPurchasable,
  unitComparison,
  type SellingUnit,
} from "@/features/catalog/domain/selling-unit";
import { formatIls } from "@/shared/lib/format-currency";

// How the customer buys the chosen variant. This is not the cart quantity: it says what one
// «item» in the cart is (a piece, a 3-pack); the quantity control then counts those items.
export function SellingUnitSelector({
  units,
  selectedId,
  offer,
  onSelect,
}: {
  units: readonly SellingUnit[];
  selectedId: string | null;
  offer: VariantOffer | undefined;
  onSelect: (unit: SellingUnit) => void;
}) {
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  if (units.length < 2) {
    const only = units[0];
    // A variant sold only as a pack still says so, so the quantity is never read as pieces.
    return only && only.unitsPerSale > 1 ? (
      <p className="selling-unit-only">
        طريقة الشراء: <bdi dir="auto">{only.labelAr}</bdi>
      </p>
    ) : null;
  }
  const single = units.find((unit) => unit.unitsPerSale === 1) ?? null;
  const selectable = units.filter(isSellingUnitPurchasable);

  // Radio-group keys: arrows move between purchasable units, in the reading order of the page (RTL).
  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const keys: Record<string, number> = {
      ArrowLeft: 1,
      ArrowDown: 1,
      ArrowRight: -1,
      ArrowUp: -1,
    };
    const step = keys[event.key];
    if (!step) return;
    event.preventDefault();
    const order = units
      .map((unit, position) => ({ unit, position }))
      .filter(({ unit }) => isSellingUnitPurchasable(unit));
    if (!order.length) return;
    const current = order.findIndex(({ position }) => position === index);
    const next = order[(current + step + order.length) % order.length]!;
    onSelect(next.unit);
    buttons.current[next.position]?.focus();
  }

  return (
    <fieldset className="selling-unit-selector">
      <legend className="variant-selector-label">طريقة الشراء</legend>
      <div
        className="selling-unit-options"
        role="radiogroup"
        aria-label="طريقة الشراء"
      >
        {units.map((unit, index) => {
          const selected = unit.id === selectedId;
          const purchasable = isSellingUnitPurchasable(unit);
          const priced = priceSellingUnit(
            unit,
            offerForSellingUnit(unit, offer),
            1,
          );
          const comparison = unitComparison(unit, single);
          const focusable = selected || (!selectedId && unit === selectable[0]);
          return (
            <button
              key={unit.id}
              ref={(element) => {
                buttons.current[index] = element;
              }}
              type="button"
              role="radio"
              className="selling-unit-option"
              aria-checked={selected}
              data-selected={selected}
              disabled={!purchasable}
              tabIndex={focusable ? 0 : -1}
              onKeyDown={(event) => onKeyDown(event, index)}
              onClick={() => onSelect(unit)}
            >
              <span className="selling-unit-check" aria-hidden="true">
                {selected ? "✓" : ""}
              </span>
              <span className="selling-unit-text">
                <span className="selling-unit-label">
                  <bdi dir="auto">{unit.labelAr}</bdi>
                </span>
                <span className="selling-unit-price">
                  <bdi dir="ltr">{formatIls(priced.unitPriceAgorot)}</bdi>
                </span>
                {comparison ? (
                  <span className="selling-unit-note">
                    <bdi dir="ltr">{comparison.perPiece}</bdi>
                    {comparison.cheaper ? " · أوفر من شراء الحبة منفردة" : ""}
                  </span>
                ) : null}
                {!purchasable ? (
                  <span className="selling-unit-note">غير متوفر حالياً</span>
                ) : null}
              </span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
