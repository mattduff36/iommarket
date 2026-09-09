import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  requireRoleMock,
  attachUnmatchedListingPaymentMock,
  logAdminActionMock,
  revalidatePathMock,
  captureExceptionMock,
} = vi.hoisted(() => ({
  requireRoleMock: vi.fn(),
  attachUnmatchedListingPaymentMock: vi.fn(),
  logAdminActionMock: vi.fn(),
  revalidatePathMock: vi.fn(),
  captureExceptionMock: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  requireRole: requireRoleMock,
}));

vi.mock("@/lib/payments/attach-unmatched-listing", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/payments/attach-unmatched-listing")
  >("@/lib/payments/attach-unmatched-listing");
  return {
    ...actual,
    attachUnmatchedListingPayment: attachUnmatchedListingPaymentMock,
  };
});

vi.mock("@/lib/admin/audit", () => ({
  logAdminAction: logAdminActionMock,
}));

vi.mock("next/cache", () => ({
  revalidatePath: revalidatePathMock,
}));

vi.mock("@/lib/monitoring", () => ({
  captureException: captureExceptionMock,
}));

import { adminAttachUnmatchedListing } from "@/actions/admin/payments";

const LISTING_ID = "caaaaaaaaaaaaaaaaaaaaaaaa";
const INBOX_ID = "cbbbbbbbbbbbbbbbbbbbbbbbb";

describe("adminAttachUnmatchedListing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireRoleMock.mockResolvedValue({ id: "admin-1", role: "ADMIN" });
    attachUnmatchedListingPaymentMock.mockResolvedValue({
      inboxId: INBOX_ID,
      listingId: LISTING_ID,
      merchantReference: "v1:listing_payment:bound",
      amountPence: 499,
    });
  });

  it("RIP-ADMIN-001 requires admin and writes an audit log after attach", async () => {
    await expect(
      adminAttachUnmatchedListing({
        inboxId: INBOX_ID,
        listingId: LISTING_ID,
      }),
    ).resolves.toEqual({
      data: {
        inboxId: INBOX_ID,
        listingId: LISTING_ID,
        merchantReference: "v1:listing_payment:bound",
        amountPence: 499,
      },
    });

    expect(requireRoleMock).toHaveBeenCalledWith("ADMIN");
    expect(attachUnmatchedListingPaymentMock).toHaveBeenCalledWith({
      inboxId: INBOX_ID,
      listingId: LISTING_ID,
    });
    expect(logAdminActionMock).toHaveBeenNthCalledWith(1, {
      adminId: "admin-1",
      action: "ATTACH_UNMATCHED_LISTING_PAYMENT_INTENT",
      entityType: "PaymentWebhookInbox",
      entityId: INBOX_ID,
      details: { listingId: LISTING_ID, inboxId: INBOX_ID },
    });
    expect(logAdminActionMock).toHaveBeenNthCalledWith(2, {
      adminId: "admin-1",
      action: "ATTACH_UNMATCHED_LISTING_PAYMENT",
      entityType: "PaymentWebhookInbox",
      entityId: INBOX_ID,
      details: {
        listingId: LISTING_ID,
        inboxId: INBOX_ID,
        merchantReference: "v1:listing_payment:bound",
        amountPence: 499,
      },
    });
  });

  it("RIP-ADMIN-002 rejects a non-admin attach", async () => {
    requireRoleMock.mockRejectedValueOnce(new Error("Insufficient permissions"));

    await expect(
      adminAttachUnmatchedListing({
        inboxId: INBOX_ID,
        listingId: LISTING_ID,
      }),
    ).rejects.toThrow("Insufficient permissions");
    expect(attachUnmatchedListingPaymentMock).not.toHaveBeenCalled();
    expect(logAdminActionMock).not.toHaveBeenCalled();
  });

  it("does not apply money state when the required intent audit cannot be written", async () => {
    logAdminActionMock.mockRejectedValueOnce(new Error("audit unavailable"));

    await expect(
      adminAttachUnmatchedListing({
        inboxId: INBOX_ID,
        listingId: LISTING_ID,
      }),
    ).resolves.toEqual({ error: "audit unavailable" });

    expect(attachUnmatchedListingPaymentMock).not.toHaveBeenCalled();
    expect(captureExceptionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "adminAttachUnmatchedListing",
      }),
    );
  });

  it("RIP-ADMIN-005 keeps a successful attach successful if outcome audit logging fails", async () => {
    logAdminActionMock
      .mockResolvedValueOnce({ id: "intent-audit" })
      .mockRejectedValueOnce(new Error("audit unavailable"));

    await expect(
      adminAttachUnmatchedListing({
        inboxId: INBOX_ID,
        listingId: LISTING_ID,
      }),
    ).resolves.toEqual({
      data: {
        inboxId: INBOX_ID,
        listingId: LISTING_ID,
        merchantReference: "v1:listing_payment:bound",
        amountPence: 499,
      },
    });

    expect(attachUnmatchedListingPaymentMock).toHaveBeenCalledOnce();
    expect(captureExceptionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "adminAttachUnmatchedListingAudit",
        tags: { inboxId: INBOX_ID, listingId: LISTING_ID },
      }),
    );
  });
});
