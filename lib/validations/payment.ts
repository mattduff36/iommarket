import { z } from "zod";

export const createCheckoutSchema = z.object({
  listingId: z.string().cuid("Invalid listing ID"),
});

export const payForListingSchema = z
  .object({
    listingId: z.string().cuid("Invalid listing ID"),
    privateSellerTermsAccepted: z.literal(true).optional(),
  })
  .strict();

export const createDealerSubscriptionSchema = z.object({
  dealerId: z.string().cuid("Invalid dealer ID"),
  tier: z.enum(["STARTER", "PRO"]).default("STARTER"),
  acceptedDealerTerms: z
    .boolean()
    .refine(
      (value) => value === true,
      "Please accept the Dealer Terms, Acceptable Use Policy, and Refund Policy.",
    ),
});

export type CreateCheckoutInput = z.infer<typeof createCheckoutSchema>;
export type PayForListingInput = z.infer<typeof payForListingSchema>;
export type CreateDealerSubscriptionInput = z.infer<
  typeof createDealerSubscriptionSchema
>;
