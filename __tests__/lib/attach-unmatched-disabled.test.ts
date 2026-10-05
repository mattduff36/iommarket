import { describe, expect, it } from "vitest";
import {
  AttachUnmatchedListingError,
  attachUnmatchedListingPayment,
} from "@/lib/payments/attach-unmatched-listing";

describe("unmatched payment attachment", () => {
  it("PAY-ATTACH-CLAIM-001 fails closed instead of bypassing checkout claims", async () => {
    await expect(
      attachUnmatchedListingPayment({
        inboxId: "cbbbbbbbbbbbbbbbbbbbbbbbb",
        listingId: "caaaaaaaaaaaaaaaaaaaaaaaa",
        confirmedCurrentlyPaidAndNotRefunded: true,
      }),
    ).rejects.toBeInstanceOf(AttachUnmatchedListingError);
  });
});
