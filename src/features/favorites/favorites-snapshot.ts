import { z } from "zod";

import { productIdSchema } from "@/features/catalog/domain/product";

export const FAVORITES_SNAPSHOT_KEY = "souq-maythalun:favorites-snapshot:v1";

const snapshotSchema = z
  .array(z.object({ id: productIdSchema, name: z.string().min(1).max(200) }))
  .max(100);

export type FavoritesSnapshot = z.infer<typeof snapshotSchema>;

export function readFavoritesSnapshot(raw: string | null): FavoritesSnapshot {
  if (!raw) return [];
  try {
    const parsed = snapshotSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}
