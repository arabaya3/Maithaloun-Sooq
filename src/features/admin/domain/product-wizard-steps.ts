export const wizardSteps = [
  { id: 1, label: "المعلومات الأساسية", anchor: "overview" },
  { id: 2, label: "الخيارات والأصناف", anchor: "variants" },
  { id: 3, label: "الصور", anchor: "wizard-images" },
  { id: 4, label: "الأسعار والمخزون", anchor: "wizard-prices" },
  { id: 5, label: "المراجعة والنشر", anchor: "wizard-review" },
] as const;

const guideByStep: Record<number, string> = {
  3: "images",
  4: "prices",
  5: "review",
};

/** Where a step lives: steps 1–2 in the wizard, 3–5 in the product's own workspace. */
export function wizardStepHref(step: number, productId: string | null) {
  if (!productId) return step === 1 ? "/admin/products/new" : null;
  if (step <= 2) return `/admin/products/new?product=${productId}&step=${step}`;
  const anchor = wizardSteps.find((item) => item.id === step)!.anchor;
  return `/admin/products/${productId}?guide=${guideByStep[step]}#${anchor}`;
}
