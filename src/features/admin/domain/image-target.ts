import { z } from "zod";

/** Where an image belongs, as the admin and the assistant choose it. */
export type ImageTarget =
  | { scope: "unassigned" }
  | { scope: "product" }
  | { scope: "option_value"; valueId: string }
  | { scope: "variant"; variantDomainId: string };

const uuid = z.uuid();
const variantDomainId = z.string().regex(/^[a-z0-9-]{1,100}$/);

// One form value names the target: "product", "unassigned", "value:<uuid>" or "variant:<domain id>".
export function parseImageTarget(
  text: string | null | undefined,
): ImageTarget | null {
  if (text === "product" || text === "unassigned") return { scope: text };
  const value = text ?? "";
  const colon = value.indexOf(":");
  const kind = colon < 0 ? value : value.slice(0, colon);
  const id = colon < 0 ? "" : value.slice(colon + 1);
  if (kind === "value" && uuid.safeParse(id).success)
    return { scope: "option_value", valueId: id };
  if (kind === "variant" && variantDomainId.safeParse(id).success)
    return { scope: "variant", variantDomainId: id };
  return null;
}

export function imageTargetValue(image: {
  scope: string;
  variantId: string | null;
  optionValueId: string | null;
}): string {
  if (image.scope === "variant" && image.variantId)
    return `variant:${image.variantId}`;
  if (image.scope === "option_value" && image.optionValueId)
    return `value:${image.optionValueId}`;
  return image.scope === "product" ? "product" : "unassigned";
}
