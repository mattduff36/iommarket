/**
 * Direct attachment of an unmatched webhook is intentionally retired.
 * A receipt without the checkout's signed merchant reference cannot prove
 * which local payment owns it. Recovery must use the persisted checkout
 * attempt and the audited reconciliation queue.
 */
export class AttachUnmatchedListingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AttachUnmatchedListingError";
  }
}

export async function attachUnmatchedListingPayment(_input: {
  inboxId: string;
  listingId: string;
  confirmedCurrentlyPaidAndNotRefunded: boolean;
}): Promise<{
  inboxId: string;
  listingId: string;
  merchantReference: string;
  providerPaymentId: string;
  amountPence: number;
}> {
  throw new AttachUnmatchedListingError(
    "Direct webhook attachment is disabled. Use the payment reconciliation queue with the matching persisted checkout attempt.",
  );
}
