import { beforeEach, describe, expect, it, vi } from "vitest";

const { sendResendEmailMock, captureExceptionMock, listingFindUnique } = vi.hoisted(
  () => ({
    sendResendEmailMock: vi.fn(),
    captureExceptionMock: vi.fn(),
    listingFindUnique: vi.fn(),
  }),
);

vi.mock("@/lib/email/client", () => ({
  sendResendEmail: sendResendEmailMock,
  getModerationInbox: () => ["moderation@example.com"],
}));

vi.mock("@/lib/monitoring", () => ({
  captureBusinessEvent: vi.fn(),
  captureException: captureExceptionMock,
}));

vi.mock("@/lib/db", () => ({
  db: {
    listing: {
      findUnique: listingFindUnique,
    },
  },
}));

import { dispatchListingNotifications } from "@/lib/email/listing-notifications";

describe("listing notification dispatch ALR-MAIL-002", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listingFindUnique.mockResolvedValue({
      id: "listing-1",
      title: "Test van",
      user: { email: "seller@example.com" },
    });
  });

  it("does not throw when Resend is unset or rejects", async () => {
    sendResendEmailMock.mockResolvedValueOnce(undefined);
    sendResendEmailMock.mockRejectedValueOnce(new Error("Resend threw"));

    await expect(
      dispatchListingNotifications([
        {
          eventId: "e1",
          listingId: "listing-1",
          action: "SUBMIT",
          fromStatus: "DRAFT",
          toStatus: "PENDING",
          reasonCode: null,
        },
      ]),
    ).resolves.toBeUndefined();

    sendResendEmailMock.mockRejectedValue(new Error("Resend threw"));
    captureExceptionMock.mockRejectedValue(new Error("monitor down"));

    await expect(
      dispatchListingNotifications([
        {
          eventId: "e2",
          listingId: "listing-1",
          action: "APPROVE",
          fromStatus: "PENDING",
          toStatus: "LIVE",
          reasonCode: null,
        },
      ]),
    ).resolves.toBeUndefined();
  });
});
