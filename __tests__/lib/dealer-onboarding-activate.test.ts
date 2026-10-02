import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  commitOnboardingClaim,
  markOnboardingCompleted,
  OnboardingClaimError,
} from "@/lib/dealers/onboarding/activate";
import { ONBOARDING_PRO_ENDS_AT } from "@/lib/dealers/onboarding/grant-plan";

const userUpdate = vi.fn();
const acceptanceUpsert = vi.fn();
const dealerUpdate = vi.fn();
const subscriptionUpdateMany = vi.fn();
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
      revokedAt: null as Date | null,
      currentPeriodEnd: new Date("2026-12-01T00:00:00.000Z"),
      promotionCampaignId: null as string | null,
    },
  ],
  listings: Array.from({ length: 90 }, (_, index) => ({
    id: `listing-${index + 1}`,
    userId: "user-1",
    dealerId: "dealer-1",
  })),
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
    subscription: { updateMany: subscriptionUpdateMany, create: subscriptionCreate },
    dealerOnboardingInviteEvent: { create: eventCreate },
  };
}

describe("dealer onboarding activation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invite.status = "SENT";
    dealer.listings = Array.from({ length: 90 }, (_, index) => ({
      id: `listing-${index + 1}`,
      userId: "user-1",
      dealerId: "dealer-1",
    }));
    dealer.subscriptions = [{
      id: "grant-1",
      source: "ADMIN_GRANT",
      status: "ACTIVE",
      grantStartsAt: new Date("2026-09-01T00:00:00.000Z"),
      grantEndsAt: new Date("2026-12-01T00:00:00.000Z"),
      revokedAt: null,
      currentPeriodEnd: new Date("2026-12-01T00:00:00.000Z"),
      promotionCampaignId: null,
    }];
    inviteUpdateMany.mockResolvedValue({ count: 1 });
    acceptanceUpsert.mockResolvedValue({ id: "acceptance" });
    userUpdate.mockResolvedValue({});
    dealerUpdate.mockResolvedValue({});
    subscriptionUpdateMany.mockResolvedValue({ count: 1 });
    eventCreate.mockResolvedValue({});
  });

  it("reuses the existing active admin grant without inserting a conflicting grant", async () => {
    const acceptedAt = new Date("2026-10-15T00:00:00.000Z");
    const result = await commitOnboardingClaim(tx() as never, {
      inviteId: invite.id,
      tokenHash: invite.tokenHash,
      leaseToken: "lease-1",
      now: acceptedAt,
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
    expect(subscriptionUpdateMany).toHaveBeenCalledWith({
      where: {
        id: "grant-1",
        dealerId: "dealer-1",
        source: "ADMIN_GRANT",
        status: "ACTIVE",
        revokedAt: null,
      },
      data: {
        currentPeriodEnd: ONBOARDING_PRO_ENDS_AT,
        grantEndsAt: ONBOARDING_PRO_ENDS_AT,
        promotionCampaignId: "campaign-1",
      },
    });
    expect(subscriptionCreate).not.toHaveBeenCalled();
    expect(eventCreate.mock.calls[0][0].data.policySnapshot.versions.DEALER_BUNDLE).toBeTruthy();
    expect(eventCreate.mock.calls[0][0].data.metadata).toMatchObject({
      preservedUserId: "user-1",
      preservedAuthUserId: "auth-1",
      preservedDealerId: "dealer-1",
      listingCount: 90,
      grantAction: "reconcile",
      grantSubscriptionId: "grant-1",
    });

    invite.status = "FINALIZING_AUTH";
    await expect(
      commitOnboardingClaim(tx() as never, {
        inviteId: invite.id,
        tokenHash: invite.tokenHash,
        leaseToken: "lease-retry",
        now: new Date("2026-10-15T00:01:00.000Z"),
        leaseExpiresAt: new Date("2026-10-15T00:03:00.000Z"),
        recipientEmailNorm: invite.recipientEmailNorm,
        actorUserId: "user-1",
      }),
    ).resolves.toEqual({ kind: "resume" });
    expect(subscriptionUpdateMany).toHaveBeenCalledTimes(1);
    expect(subscriptionCreate).not.toHaveBeenCalled();
    expect(eventCreate).toHaveBeenCalledTimes(1);
  });

  it("creates a grant only when no active admin grant exists", async () => {
    dealer.subscriptions = [];
    const acceptedAt = new Date("2026-10-15T00:00:00.000Z");
    await commitOnboardingClaim(tx() as never, {
      inviteId: invite.id,
      tokenHash: invite.tokenHash,
      leaseToken: "lease-create",
      now: acceptedAt,
      leaseExpiresAt: new Date("2026-10-15T00:02:00.000Z"),
      recipientEmailNorm: invite.recipientEmailNorm,
      actorUserId: "user-1",
    });
    expect(subscriptionCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        dealerId: "dealer-1",
        source: "ADMIN_GRANT",
        grantStartsAt: acceptedAt,
        grantEndsAt: ONBOARDING_PRO_ENDS_AT,
        promotionCampaignId: "campaign-1",
      }),
    });
    expect(subscriptionUpdateMany).not.toHaveBeenCalled();
  });

  it("leaves a longer complimentary grant unchanged", async () => {
    dealer.subscriptions[0].grantEndsAt = new Date("2027-06-01T00:00:00.000Z");
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
    ).resolves.toMatchObject({ kind: "finalizing" });
    expect(subscriptionCreate).not.toHaveBeenCalled();
    expect(subscriptionUpdateMany).not.toHaveBeenCalled();
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
    expect(subscriptionCreate).not.toHaveBeenCalled();
    expect(subscriptionUpdateMany).not.toHaveBeenCalled();

    dealer.subscriptions[0].source = "ADMIN_GRANT";
    dealer.subscriptions[0].currentPeriodEnd = new Date("2026-12-01T00:00:00.000Z");
    const originalExpiry = invite.expiresAt;
    invite.expiresAt = new Date("2027-02-01T00:00:00.000Z");
    await expect(
      commitOnboardingClaim(tx() as never, {
        inviteId: invite.id,
        tokenHash: invite.tokenHash,
        leaseToken: "lease-ended",
        now: ONBOARDING_PRO_ENDS_AT,
        leaseExpiresAt: new Date("2027-01-01T00:02:00.000Z"),
        recipientEmailNorm: invite.recipientEmailNorm,
        actorUserId: "user-1",
      }),
    ).rejects.toThrow("Complimentary Pro access has ended.");
    invite.expiresAt = originalExpiry;
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

  it("rejects a genuinely conflicting active admin grant transactionally", async () => {
    dealer.subscriptions[0].revokedAt = new Date("2026-10-01T00:00:00.000Z");
    await expect(
      commitOnboardingClaim(tx() as never, {
        inviteId: invite.id,
        tokenHash: invite.tokenHash,
        leaseToken: "lease-conflict",
        now: new Date("2026-10-15T00:00:00.000Z"),
        leaseExpiresAt: new Date("2026-10-15T00:02:00.000Z"),
        recipientEmailNorm: invite.recipientEmailNorm,
        actorUserId: "user-1",
      }),
    ).rejects.toThrow("conflicting complimentary access");
    expect(userUpdate).not.toHaveBeenCalled();
    expect(acceptanceUpsert).not.toHaveBeenCalled();
    expect(dealerUpdate).not.toHaveBeenCalled();
    expect(subscriptionCreate).not.toHaveBeenCalled();
    expect(subscriptionUpdateMany).not.toHaveBeenCalled();
    expect(eventCreate).not.toHaveBeenCalled();
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
    expect(subscriptionUpdateMany).not.toHaveBeenCalled();
    expect(subscriptionCreate).not.toHaveBeenCalled();
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
