import { beforeEach, describe, expect, it, vi } from "vitest";

const { sendResendEmailMock, revisionFindUnique, disputeFindUnique, correspondenceFindUnique } =
  vi.hoisted(() => ({
    sendResendEmailMock: vi.fn(),
    revisionFindUnique: vi.fn(),
    disputeFindUnique: vi.fn(),
    correspondenceFindUnique: vi.fn(),
  }));

vi.mock("@/lib/email/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/email/client")>();
  return {
    ...actual,
    sendResendEmail: sendResendEmailMock,
    getModerationInbox: () => ["moderation@example.com"],
  };
});

vi.mock("@/lib/monitoring", () => ({
  captureBusinessEvent: vi.fn(),
  captureException: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    dealerReviewResponseRevision: { findUnique: revisionFindUnique },
    dealerReviewDispute: { findUnique: disputeFindUnique },
    dealerCorrespondenceSettings: { findUnique: correspondenceFindUnique },
  },
}));

import { dispatchDealerReviewNotifications } from "@/lib/email/dealer-review-notifications";

const dealer = {
  id: "dealer-1",
  name: "Isle Cars",
  user: { email: "owner@dealer.example" },
};

describe("dealer review notification routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sendResendEmailMock.mockResolvedValue(undefined);
    correspondenceFindUnique.mockResolvedValue({
      verifiedEmail: "reviews@dealer.example",
      categories: ["REVIEWS"],
      copyAssignedToPrimary: false,
    });
    revisionFindUnique.mockResolvedValue({
      id: "revision-1",
      status: "APPROVED",
      reasonCode: null,
      response: { review: { dealer } },
    });
    disputeFindUnique.mockResolvedValue({
      id: "dispute-1",
      status: "OPEN",
      decisionReasonCode: null,
      review: { dealer },
    });
  });

  it("sends a review decision to the verified second address", async () => {
    await dispatchDealerReviewNotifications([
      { kind: "RESPONSE_DECIDED", revisionId: "revision-1" },
    ]);

    expect(sendResendEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({ to: ["reviews@dealer.example"] }),
    );
  });

  it("keeps moderation alerts on the admin inbox", async () => {
    await dispatchDealerReviewNotifications([
      { kind: "DISPUTE_OPENED", disputeId: "dispute-1" },
    ]);

    expect(sendResendEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({ to: ["moderation@example.com"] }),
    );
    expect(correspondenceFindUnique).not.toHaveBeenCalled();
  });
});
