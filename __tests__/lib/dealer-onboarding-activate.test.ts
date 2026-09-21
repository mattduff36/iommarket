import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  commitOnboardingClaim,
  markOnboardingCompleted,
  OnboardingClaimError,
} from "@/lib/dealers/onboarding/activate";

const userUpdate = vi.fn();
const acceptanceUpsert = vi.fn();
const dealerUpdate = vi.fn();
const subscriptionUpdate = vi.fn();
const subscriptionCreate = vi.fn();
const inviteUpdateMany = vi.fn();
const eventCreate = vi.fn();

const invite = {
  id: "invite-1",
  tokenHash: "a".repeat(64),
  recipientEmailNorm: "owner@dealer.im",
  status: "SENT" as "SENT" | "FINALIZING_AUTH" | "COMPLETED",
  expiresAt: new Date("2026-10-20T00:00:00.000Z"),
  claimedAt: null,
  userId: "user-1",
  dealerId: "dealer-1",
  targetAuthUserId: "auth-1",
  campaignId: "campaign-1",
  campaignStartsAt: new Date("2026-10-01T08:00:00.000Z"),
  campaignEndsAt: new Date("2027-01-01T09:00:00.000Z"),
  createdByAdminId: "admin-1",
};

const dealer = {
  id: "dealer-1",
  userId: "user-1",
  isAdminPreview: false,
  user: {
    id: "user-1",
    authUserId: "auth-1",
    email: "temporary@itrader.im.preview",
    role: "DEALER",
    disabledAt: null,
    deletedAt: null,
  },
  subscriptions: [
    {
      id: "grant-1",
      source: "ADMIN_GRANT",
      status: "ACTIVE",
      grantStartsAt: new Date("2026-09-01T00:00:00.000Z"),
      grantEndsAt: new Date("2026-12-01T00:00:00.000Z"),
      revokedAt: null,
      currentPeriodEnd: new Date("2026-12-01T00:00:00.000Z"),
    },
  ],
  listings: [{ id: "listing-1", userId: "user-1", dealerId: "dealer-1" }],
};

function tx() {
  return {
    dealerOnboardingInvite: {
      findUnique: vi.fn(async () => invite),
      updateMany: inviteUpdateMany,
    },
    dealerProfile: {
      findUnique: vi.fn(async () => dealer),
      update: dealerUpdate,
    },
    user: {
      findFirst: vi.fn(async () => null),
      update: userUpdate,
      findUnique: vi.fn(async () => ({
        id: "user-1",
        authUserId: "auth-1",
        email: "owner@dealer.im",
      })),
    },
    policyAcceptance: { upsert: acceptanceUpsert },
    subscription: { update: subscriptionUpdate, create: subscriptionCreate },
    dealerOnboardingInviteEvent: { create: eventCreate },
  };
}

describe("dealer onboarding activation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invite.status = "SENT";
    dealer.listings = [{ id: "listing-1", userId: "user-1", dealerId: "dealer-1" }];
    dealer.subscriptions[0].source = "ADMIN_GRANT";
    inviteUpdateMany.mockResolvedValue({ count: 1 });
    acceptanceUpsert.mockResolvedValue({ id: "acceptance" });
    userUpdate.mockResolvedValue({});
    dealerUpdate.mockResolvedValue({});
    subscriptionUpdate.mockResolvedValue({});
    eventCreate.mockResolvedValue({});
  });

  it("preserves identities, records every current policy, and keeps the later grant end", async () => {
    const result = await commitOnboardingClaim(tx() as never, {
      inviteId: invite.id,
      tokenHash: invite.tokenHash,
      leaseToken: "lease-1",
      now: new Date("2026-10-15T00:00:00.000Z"),
      leaseExpiresAt: new Date("2026-10-15T00:02:00.000Z"),
      recipientEmailNorm: invite.recipientEmailNorm,
      actorUserId: "user-1",
    });

    expect(result.kind).toBe("finalizing");
    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { email: "owner@dealer.im" },
    });
    expect(acceptanceUpsert).toHaveBeenCalledTimes(4);
    expect(dealerUpdate).toHaveBeenCalledWith({
      where: { id: "dealer-1" },
      data: { tier: "PRO" },
    });
    expect(subscriptionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "grant-1" },
        data: expect.objectContaining({
          grantEndsAt: new Date("2027-01-01T09:00:00.000Z"),
          promotionCampaignId: "campaign-1",
        }),
      }),
    );
    expect(subscriptionCreate).not.toHaveBeenCalled();
    expect(eventCreate.mock.calls[0][0].data.policySnapshot.versions.DEALER_BUNDLE).toBeTruthy();
    expect(eventCreate.mock.calls[0][0].data.metadata).toMatchObject({
      preservedUserId: "user-1",
      preservedAuthUserId: "auth-1",
      preservedDealerId: "dealer-1",
      listingCount: 1,
    });
  });

  it("does not change a paid subscription or mismatched listing ownership", async () => {
    dealer.subscriptions[0].source = "PAYMENT";
    dealer.subscriptions[0].currentPeriodEnd = new Date("2026-12-01T00:00:00.000Z");
    await expect(
      commitOnboardingClaim(tx() as never, {
        inviteId: invite.id,
        tokenHash: invite.tokenHash,
        leaseToken: "lease-1",
        now: new Date("2026-10-15T00:00:00.000Z"),
        leaseExpiresAt: new Date("2026-10-15T00:02:00.000Z"),
        recipientEmailNorm: invite.recipientEmailNorm,
        actorUserId: "user-1",
      }),
    ).rejects.toBeInstanceOf(OnboardingClaimError);
    expect(userUpdate).not.toHaveBeenCalled();

    dealer.subscriptions[0].source = "ADMIN_GRANT";
    dealer.listings = [{ id: "listing-1", userId: "other-user", dealerId: "dealer-1" }];
    await expect(
      commitOnboardingClaim(tx() as never, {
        inviteId: invite.id,
        tokenHash: invite.tokenHash,
        leaseToken: "lease-2",
        now: new Date("2026-10-15T00:00:00.000Z"),
        leaseExpiresAt: new Date("2026-10-15T00:02:00.000Z"),
        recipientEmailNorm: invite.recipientEmailNorm,
        actorUserId: "user-1",
      }),
    ).rejects.toThrow("can no longer be claimed");
  });

  it("resumes a finalizing claim without repeating acceptance or the grant", async () => {
    invite.status = "FINALIZING_AUTH";
    await expect(
      commitOnboardingClaim(tx() as never, {
        inviteId: invite.id,
        tokenHash: invite.tokenHash,
        leaseToken: "lease-1",
        now: new Date("2026-10-15T00:00:00.000Z"),
        leaseExpiresAt: new Date("2026-10-15T00:02:00.000Z"),
        recipientEmailNorm: invite.recipientEmailNorm,
        actorUserId: "user-1",
      }),
    ).resolves.toEqual({ kind: "resume" });
    expect(userUpdate).not.toHaveBeenCalled();
    expect(acceptanceUpsert).not.toHaveBeenCalled();
    expect(subscriptionUpdate).not.toHaveBeenCalled();
  });

  it("lets one concurrent claim win and resumes finalization without a second event", async () => {
    inviteUpdateMany.mockResolvedValueOnce({ count: 0 });
    await expect(
      commitOnboardingClaim(tx() as never, {
        inviteId: invite.id,
        tokenHash: invite.tokenHash,
        leaseToken: "lease-1",
        now: new Date("2026-10-15T00:00:00.000Z"),
        leaseExpiresAt: new Date("2026-10-15T00:02:00.000Z"),
        recipientEmailNorm: invite.recipientEmailNorm,
        actorUserId: "user-1",
      }),
    ).rejects.toThrow("already being completed");

    invite.status = "FINALIZING_AUTH";
    const client = tx();
    client.dealerOnboardingInvite.updateMany.mockResolvedValue({ count: 1 });
    await expect(
      markOnboardingCompleted(client as never, {
        inviteId: invite.id,
        userId: "user-1",
        dealerId: "dealer-1",
        targetAuthUserId: "auth-1",
        actorUserId: "user-1",
        now: new Date("2026-10-15T00:03:00.000Z"),
      }),
    ).resolves.toEqual({ already: false });

    client.dealerOnboardingInvite.updateMany.mockResolvedValue({ count: 0 });
    client.dealerOnboardingInvite.findUnique.mockResolvedValue({
      ...invite,
      status: "COMPLETED",
    });
    await expect(
      markOnboardingCompleted(client as never, {
        inviteId: invite.id,
        userId: "user-1",
        dealerId: "dealer-1",
        targetAuthUserId: "auth-1",
        actorUserId: "user-1",
        now: new Date("2026-10-15T00:04:00.000Z"),
      }),
    ).resolves.toEqual({ already: true });
    expect(eventCreate).toHaveBeenCalledTimes(1);
  });
});
