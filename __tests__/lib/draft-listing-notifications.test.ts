import { describe, expect, it, vi, beforeEach } from "vitest";
import { DEFAULT_NOTIFICATION_PREFERENCES, visiblePreferenceKeys } from "@/lib/notifications/preferences";
const mocks = vi.hoisted(() => ({ user: vi.fn(), recipients: vi.fn(), send: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { user: { findFirst: mocks.user } } }));
vi.mock("@/lib/dealers/correspondence-routing", () => ({ resolveDealerMailRecipients: mocks.recipients }));
vi.mock("@/lib/email/client", async () => ({ ...await vi.importActual("@/lib/email/client"), sendResendEmail: mocks.send }));
import { notifyReceivedDraftListings } from "@/lib/email/draft-listing-notifications";
describe("received draft notifications", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.user.mockResolvedValue({ email: "owner@dealer.test" }); mocks.recipients.mockResolvedValue(["stock@dealer.test"]); mocks.send.mockResolvedValue(undefined); });
  it("defaults on and is available to users and dealers", () => {
    expect(DEFAULT_NOTIFICATION_PREFERENCES.draftListings).toBe(true);
    for (const role of ["USER", "DEALER"] as const) expect(visiblePreferenceKeys({ role, tradeEligible: false })).toContain("draftListings");
  });
  it("uses the independent preference, existing routing and stable delivery key", async () => {
    await notifyReceivedDraftListings({ userId: "owner", dealerId: "dealer", count: 2, deliveryKey: "receipt-batch-1" });
    expect(mocks.recipients).toHaveBeenCalledWith(expect.objectContaining({ notificationPreference: "draftListings", category: "LISTING_UPDATES" }));
    expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({ to: ["stock@dealer.test"], idempotencyKey: "draft-listings:receipt-batch-1" }));
    expect(mocks.send.mock.calls[0][0].text).toContain("2 draft listings");
  });
  it("sends nothing when opted out or the owner is inactive/mismatched", async () => {
    mocks.recipients.mockResolvedValue([]);
    await notifyReceivedDraftListings({ userId: "owner", dealerId: "dealer", count: 1, deliveryKey: "one" });
    mocks.user.mockResolvedValue(null);
    await notifyReceivedDraftListings({ userId: "owner", dealerId: "dealer", count: 1, deliveryKey: "two" });
    expect(mocks.send).not.toHaveBeenCalled();
  });
});
