import { z } from "zod";

export const serviceAreaCodeSchema = z.string().regex(/^[a-z0-9-]{1,80}$/);

export const serviceAreaSchema = z
  .object({
    code: serviceAreaCodeSchema,
    nameAr: z.string().min(1).max(120),
    enabled: z.boolean(),
    sortOrder: z.number().int().nonnegative(),
    deliveryFeeAgorot: z.number().int().nonnegative().nullable(),
  })
  .strict();

export type ServiceArea = z.infer<typeof serviceAreaSchema>;

export interface ServiceAreaRepository {
  listEnabled(): Promise<readonly ServiceArea[]>;
  getEnabledByCode(code: string): Promise<ServiceArea | null>;
}
