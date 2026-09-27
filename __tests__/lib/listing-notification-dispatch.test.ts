import { beforeEach, describe, expect, it, vi } from "vitest";

const { sendResendEmailMock, captureExceptionMock, listingFindUnique, correspondenceFindUnique } = vi.hoisted(
  () => ({
    sendResendEmailMock: vi.fn(),
    captureExceptionMock: vi.fn(),
    listingFindUnique: vi.fn(),
    correspondenceFindUnique: vi.fn(),
  }),
);

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
  captureException: captureExceptionMock,
}));

vi.mock("@/lib/db", () => ({
  db: {
    listing: {
      findUnique: listingFindUnique,
    },
    dealerCorrespondenceSettings: {
      findUnique: correspondenceFindUnique,
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
      dealerId: null,
      user: { email: "seller@example.com" },
    });
    correspondenceFindUnique.mockResolvedValue(null);
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

    expect(sendResendEmailMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ to: ["seller@example.com"] }),
    );
    expect(sendResendEmailMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ to: ["moderation@example.com"] }),
    );
    expect(correspondenceFindUnique).not.toHaveBeenCalled();

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

  it("sends selected listing updates to a verified second address", async () => {
    listingFindUnique.mockResolvedValue({
      id: "listing-1",
      title: "Test van",
      dealerId: "dealer-1",
      user: { email: "owner@dealer.example" },
    });
    correspondenceFindUnique.mockResolvedValue({
      verifiedEmail: "sales@dealer.example",
      categories: ["LISTING_UPDATES"],
      copyAssignedToPrimary: false,
    });
    sendResendEmailMock.mockResolvedValue(undefined);

    await dispatchListingNotifications([
      {
        eventId: "e3",
        listingId: "listing-1",
        action: "APPROVE",
        fromStatus: "PENDING",
        toStatus: "LIVE",
        reasonCode: null,
      },
    ]);

    expect(sendResendEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({ to: ["sales@dealer.example"] }),
    );
  });

  it("copies assigned listing updates to the login address when requested", async () => {
    listingFindUnique.mockResolvedValue({
      id: "listing-1",
      title: "Test van",
      dealerId: "dealer-1",
      user: { email: "owner@dealer.example" },
    });
    correspondenceFindUnique.mockResolvedValue({
      verifiedEmail: "sales@dealer.example",
      categories: ["LISTING_UPDATES"],
      copyAssignedToPrimary: true,
    });
    sendResendEmailMock.mockResolvedValue(undefined);

    await dispatchListingNotifications([
      {
        eventId: "e4",
        listingId: "listing-1",
        action: "APPROVE",
        fromStatus: "PENDING",
        toStatus: "LIVE",
        reasonCode: null,
      },
    ]);

    expect(sendResendEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: ["sales@dealer.example", "owner@dealer.example"],
      }),
    );
  });
});
