import { z } from "zod";

export const orderConfirmationSchema = z
  .object({
    publicReference: z.string().regex(/^MS-[A-Za-z0-9_-]{24}$/),
    status: z.literal("pending"),
    itemsSubtotalAgorot: z.number().int().nonnegative(),
    deliveryFeeAgorot: z.number().int().nonnegative().nullable(),
    finalTotalAgorot: z.number().int().nonnegative().nullable(),
    paymentMethod: z.literal("cash_on_delivery"),
    duplicate: z.boolean(),
  })
  .strict();

export type OrderConfirmation = z.infer<typeof orderConfirmationSchema>;

export const orderApiResponseSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    confirmation: orderConfirmationSchema,
  }),
  z.object({
    ok: z.literal(false),
    message: z.string(),
    fieldErrors: z
      .record(z.string(), z.array(z.string()).optional())
      .optional(),
  }),
]);
