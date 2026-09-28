import { z } from "zod";

export const acceptDealerUpgradeSchema = z.object({
  offerId: z.string().cuid(),
  policyDigest: z.string().regex(/^[a-f0-9]{64}$/),
  dealerPoliciesAccepted: z.literal(true, {
    error: "Accept the current dealer documents to activate the upgrade.",
  }),
});

export type AcceptDealerUpgradeInput = z.infer<
  typeof acceptDealerUpgradeSchema
>;
