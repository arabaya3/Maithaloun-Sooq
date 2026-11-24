import { z } from "zod";

const code = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/);

export const reclassificationPlanSchema = z.object({
  description: z.string().optional(),
  createdOn: z.string().optional(),
  entries: z.array(
    z.object({
      productId: z.string().regex(/^[a-z0-9-]{1,80}$/),
      name: z.string().optional(),
      currentPrimary: code,
      primary: code,
      extras: z.array(code).max(8),
      reason: z.string().min(1),
    }),
  ),
  unclear: z.array(z.record(z.string(), z.string())).optional(),
});
export type ReclassificationPlan = z.infer<typeof reclassificationPlanSchema>;

/** One product as it is in the database now: its primary and every category it is listed in. */
export interface CurrentAssignment {
  productId: string;
  primary: string;
  links: readonly string[];
}

export type PlannedChange =
  | {
      kind: "change";
      productId: string;
      name?: string;
      fromPrimary: string;
      toPrimary: string;
      addLinks: string[];
      removeLinks: string[];
      reason: string;
    }
  | { kind: "unchanged"; productId: string }
  | { kind: "skipped"; productId: string; why: string };

/**
 * Compares the plan with the database. Pure, so a second run after --apply finds nothing to do.
 * An entry is skipped, never forced, when its product is missing, has moved to another primary
 * category since the plan was written, or names a category that does not exist.
 */
export function planReclassification(
  plan: ReclassificationPlan,
  current: ReadonlyMap<string, CurrentAssignment>,
  usableCategories: ReadonlySet<string>,
): PlannedChange[] {
  return plan.entries.map((entry) => {
    const now = current.get(entry.productId);
    if (!now)
      return {
        kind: "skipped",
        productId: entry.productId,
        why: "product not found",
      };
    const wanted = [...new Set([entry.primary, ...entry.extras])];
    const missing = wanted.filter((item) => !usableCategories.has(item));
    if (missing.length)
      return {
        kind: "skipped",
        productId: entry.productId,
        why: `unknown or archived category: ${missing.join(", ")}`,
      };
    if (now.primary !== entry.currentPrimary && now.primary !== entry.primary)
      return {
        kind: "skipped",
        productId: entry.productId,
        why: `primary is now ${now.primary}, the plan expected ${entry.currentPrimary}`,
      };
    const have = new Set([now.primary, ...now.links]);
    const addLinks = wanted.filter((item) => !have.has(item));
    const removeLinks = [...have].filter((item) => !wanted.includes(item));
    if (
      now.primary === entry.primary &&
      !addLinks.length &&
      !removeLinks.length
    )
      return { kind: "unchanged", productId: entry.productId };
    return {
      kind: "change",
      productId: entry.productId,
      name: entry.name,
      fromPrimary: now.primary,
      toPrimary: entry.primary,
      addLinks,
      removeLinks,
      reason: entry.reason,
    };
  });
}

export const backupSchema = z.object({
  kind: z.literal("maytha-category-backup"),
  createdAt: z.string(),
  database: z.string(),
  products: z.array(
    z.object({
      productId: z.string(),
      primary: code,
      links: z.array(code),
    }),
  ),
});
export type CategoryBackup = z.infer<typeof backupSchema>;
