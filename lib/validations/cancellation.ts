import { z } from "zod";

export const requestDealerCancellationSchema = z.object({
  confirmation: z
    .boolean()
    .refine((value) => value, "Confirm you want to request cancellation."),
});

export const staffCancellationActionSchema = z.object({
  requestId: z.string().cuid(),
  action: z.enum(["ACKNOWLEDGE", "RECONCILE", "REJECT", "COMPLETE"]),
  notes: z.string().trim().max(2000).optional(),
});

export type RequestDealerCancellationInput = z.infer<
  typeof requestDealerCancellationSchema
>;
export type StaffCancellationActionInput = z.infer<
  typeof staffCancellationActionSchema
>;
