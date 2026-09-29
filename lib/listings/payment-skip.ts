import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getPaidSubscriptionEntitlementWhere } from "@/lib/dealers/entitlement";

type DbClient = Prisma.TransactionClient | typeof db;

export async function canSkipListingPayment(
  client: DbClient,
  input: {
    listingId: string;
    userId: string;
    dealerId: string | null;
    now?: Date;
  },
) {
  const now = input.now ?? new Date();
  if (input.dealerId) {
    const [paid, grant] = await Promise.all([
      client.subscription.findFirst({
        where: {
          dealerId: input.dealerId,
          ...getPaidSubscriptionEntitlementWhere(now),
        },
        select: { id: true },
      }),
      client.subscription.findFirst({
        where: {
          dealerId: input.dealerId,
          source: "ADMIN_GRANT",
          status: "ACTIVE",
          revokedAt: null,
          grantStartsAt: { lte: now },
          grantEndsAt: { gt: now },
        },
        select: { id: true },
      }),
    ]);
    if (paid || grant) {
      return { skip: true as const, reason: "dealer" as const };
    }
  }

  const payment = await client.payment.findFirst({
    where: {
      listingId: input.listingId,
      type: "LISTING",
      status: "SUCCEEDED",
    },
    select: { id: true },
  });
  if (payment) {
    return { skip: true as const, reason: "paid" as const };
  }

  const claim = await client.freeListingClaim.findUnique({
    where: { listingId: input.listingId },
    select: { id: true, userId: true },
  });
  if (claim && claim.userId === input.userId) {
    return { skip: true as const, reason: "claimed" as const };
  }

  return { skip: false as const, reason: "ineligible" as const };
}
