import { z } from "zod";

export const createCheckoutSchema = z.object({
  listingId: z.string().cuid("Invalid listing ID"),
});

export const payForListingSchema = z.object({
  listingId: z.string().cuid("Invalid listing ID"),
  supportAmountPence: z
    .number()
    .int("Support amount must be a whole number in pence")
    .min(0, "Support amount cannot be negative")
    .max(500, "Support amount cannot exceed £5")
    .default(0),
});

export const createDealerSubscriptionSchema = z.object({
  dealerId: z.string().cuid("Invalid dealer ID"),
  tier: z.enum(["STARTER", "PRO"]).default("STARTER"),
});

export type CreateCheckoutInput = z.infer<typeof createCheckoutSchema>;
export type PayForListingInput = z.infer<typeof payForListingSchema>;
export type CreateDealerSubscriptionInput = z.infer<
  typeof createDealerSubscriptionSchema
>;
