import { describe, expect, it } from "vitest";
import {
  buildAdminSubmissionEmail,
  buildListingStatusEmail,
} from "@/lib/email/listing-notifications";
import { buildDealerVerificationEmail } from "@/lib/email/dealer-notifications";
import {
  isListingResubmit,
  shouldNotifyAdminSubmission,
  shouldNotifySellerStatusChange,
} from "@/lib/listings/notification-intents";

describe("listing notification copy ALR-MAIL-001 ALR-MAIL-004", () => {
  it("has seller copy for every lifecycle action except backfill ALR-MAIL-001", () => {
    const actions = [
      "SUBMIT",
      "APPROVE",
      "REJECT",
      "TAKE_DOWN",
      "EXPIRE",
      "MARK_SOLD",
      "RENEW",
      "REINSTATE_LIVE",
      "RETURN_TO_DRAFT",
      "ACCOUNT_DISABLE",
      "ACCOUNT_DISABLE_PENDING",
      "SUBMIT_REVISION",
      "APPROVE_REVISION",
      "REJECT_REVISION",
    ] as const;
    for (const action of actions) {
      expect(buildListingStatusEmail({ action, listingTitle: "Van" })).not.toBeNull();
    }
    expect(buildListingStatusEmail({ action: "SYSTEM_BACKFILL", listingTitle: "Van" })).toBeNull();
  });

  it("builds seller copy for real status changes and never interpolates notes", () => {
    const email = buildListingStatusEmail({
      action: "REJECT",
      listingTitle: "Test van",
      reasonCode: "FRAUD",
    });
    expect(email?.subject).toContain("not approved");
    expect(email?.text).toContain("Fraud or scam");
    expect(email?.text).not.toContain("internal");
    expect(email?.html).not.toContain("adminNotes");
    expect(buildListingStatusEmail({ action: "SYSTEM_BACKFILL", listingTitle: "x" })).toBeNull();
  });

  it("notifies admin on submit and revision submit ALR-MAIL-001", () => {
    expect(
      shouldNotifyAdminSubmission({
        eventId: "e1",
        listingId: "l1",
        action: "SUBMIT",
        fromStatus: "DRAFT",
        toStatus: "PENDING",
        reasonCode: null,
      }),
    ).toBe(true);
    expect(
      shouldNotifyAdminSubmission({
        eventId: "e2",
        listingId: "l1",
        action: "SUBMIT_REVISION",
        fromStatus: "LIVE",
        toStatus: "LIVE",
        reasonCode: null,
      }),
    ).toBe(true);
    const admin = buildAdminSubmissionEmail({
      listingTitle: "Test van",
      listingId: "l1",
      isResubmit: true,
      isRevision: false,
    });
    expect(admin.subject).toContain("resubmitted");
  });

  it("skips seller status mail for same-status and backfill events", () => {
    expect(
      shouldNotifySellerStatusChange({
        eventId: "e1",
        listingId: "l1",
        action: "SUBMIT_REVISION",
        fromStatus: "LIVE",
        toStatus: "LIVE",
        reasonCode: null,
      }),
    ).toBe(false);
    expect(
      shouldNotifySellerStatusChange({
        eventId: "e1",
        listingId: "l1",
        action: "SYSTEM_BACKFILL",
        fromStatus: "APPROVED",
        toStatus: "LIVE",
        reasonCode: null,
      }),
    ).toBe(false);
    expect(
      isListingResubmit({
        eventId: "e1",
        listingId: "l1",
        action: "SUBMIT",
        fromStatus: "TAKEN_DOWN",
        toStatus: "PENDING",
        reasonCode: null,
      }),
    ).toBe(true);
  });

  it("builds dealer verify and unverify emails ALR-MAIL-003", () => {
    expect(buildDealerVerificationEmail({ dealerName: "Isle Cars", verified: true }).subject)
      .toMatch(/verified/i);
    expect(buildDealerVerificationEmail({ dealerName: "Isle Cars", verified: false }).subject)
      .toMatch(/removed/i);
  });
});
