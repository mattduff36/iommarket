import { z } from "zod";

export const createCheckoutSchema = z.object({
  listingId: z.string().cuid("Invalid listing ID"),
});

export const createDealerSubscriptionSchema = z.object({
  dealerId: z.string().cuid("Invalid dealer ID"),
});

export type CreateCheckoutInput = z.infer<typeof createCheckoutSchema>;
export type CreateDealerSubscriptionInput = z.infer<
  typeof createDealerSubscriptionSchema
>;
