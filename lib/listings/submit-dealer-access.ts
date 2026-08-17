import type { Prisma } from "@prisma/client";
import {
  effectiveListingDealerId,
  hasDealerAccountAccess,
  type DealerAccessSubject,
} from "@/lib/dealers/entitlement";

type ListingWriteClient = {
  listing: {
    update: (args: {
      where: { id: string };
      data: { dealerId: null };
    }) => Promise<unknown>;
  };
};

export { effectiveListingDealerId };

export function shouldDetachListingDealerId(
  user: DealerAccessSubject,
  listing: { dealerId: string | null },
) {
  return listing.dealerId !== null && !hasDealerAccountAccess(user);
}

export async function detachListingDealerIdIfNeeded(
  client: ListingWriteClient,
  listingId: string,
  user: DealerAccessSubject,
  listing: { dealerId: string | null },
) {
  if (!shouldDetachListingDealerId(user, listing)) return false;
  await client.listing.update({
    where: { id: listingId },
    data: { dealerId: null },
  });
  return true;
}

export async function runWithDealerDetach<T>(
  db: ListingWriteClient & {
    $transaction: <R>(
      fn: (tx: Prisma.TransactionClient) => Promise<R>,
    ) => Promise<R>;
  },
  input: {
    listingId: string;
    user: DealerAccessSubject;
    listing: { dealerId: string | null };
    submit: (client?: Prisma.TransactionClient) => Promise<T>;
  },
) {
  if (!shouldDetachListingDealerId(input.user, input.listing)) {
    return input.submit();
  }

  return db.$transaction(async (tx) => {
    await detachListingDealerIdIfNeeded(
      tx,
      input.listingId,
      input.user,
      input.listing,
    );
    return input.submit(tx);
  });
}
