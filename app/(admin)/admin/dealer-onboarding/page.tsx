export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { db } from "@/lib/db";
import { formatIsleOfManDateTime, LAUNCH_PROMOTION_KEY } from "@/lib/dealers/onboarding/campaign-window";
import { planPromotionGrant } from "@/lib/dealers/onboarding/grant-plan";
import {
  canResendOnboardingInvite,
  canRevokeOnboardingInvite,
  displayOnboardingStatus,
} from "@/lib/dealers/onboarding/statuses";
import { OnboardingManager } from "./onboarding-manager";

export const metadata: Metadata = { title: "Dealer onboarding | Admin" };

const STATUS_LABELS = {
  SEND_FAILED: "Send failed",
  SENT: "Sent",
  CLAIMING: "Claiming",
  FINALIZING_AUTH: "Finalizing",
  COMPLETED: "Completed",
  REVOKED: "Revoked",
  EXPIRED: "Expired",
} as const;

interface Props {
  searchParams: Promise<{ dealer?: string }>;
}

export default async function AdminDealerOnboardingPage({ searchParams }: Props) {
  const params = await searchParams;
  const now = new Date();
  const [campaign, dealers, invites] = await Promise.all([
    db.dealerPromotionCampaign.findUnique({ where: { key: LAUNCH_PROMOTION_KEY } }),
    db.dealerProfile.findMany({
      where: {
        isAdminPreview: false,
        user: { role: "DEALER", deletedAt: null, disabledAt: null },
      },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        tier: true,
        user: { select: { email: true } },
        subscriptions: {
          select: {
            source: true,
            status: true,
            grantStartsAt: true,
            grantEndsAt: true,
            revokedAt: true,
            currentPeriodEnd: true,
          },
        },
      },
    }),
    db.dealerOnboardingInvite.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { dealer: { select: { name: true } } },
    }),
  ]);

  return (
    <>
      <h1 className="mb-2 text-2xl font-bold text-text-primary">Dealer onboarding</h1>
      <p className="mb-6 max-w-3xl text-sm text-text-secondary">
        Send one email that lets a dealer claim an existing account, set a password, and accept the account and dealer documents. The profile and listings stay on the same account.
      </p>
      <OnboardingManager
        selectedDealerId={params.dealer ?? null}
        campaign={
          campaign
            ? {
                startsLabel: formatIsleOfManDateTime(campaign.startsAt),
                endsLabel: formatIsleOfManDateTime(campaign.endsAt),
                locked: Boolean(campaign.lockedAt),
              }
            : null
        }
        dealers={dealers.map((dealer) => {
          const grant = campaign
            ? planPromotionGrant({
                subscriptions: dealer.subscriptions,
                campaignStartsAt: campaign.startsAt,
                campaignEndsAt: campaign.endsAt,
                now,
              })
            : null;
          const activeGrant = dealer.subscriptions.find(
            (subscription) =>
              subscription.source === "ADMIN_GRANT" &&
              subscription.status === "ACTIVE" &&
              !subscription.revokedAt &&
              subscription.grantEndsAt &&
              subscription.grantEndsAt > now,
          );
          return {
            id: dealer.id,
            name: dealer.name,
            currentEmail: dealer.user.email,
            tier: dealer.tier,
            accessLabel: activeGrant?.grantEndsAt
              ? `Free grant until ${formatIsleOfManDateTime(activeGrant.grantEndsAt)}`
              : "No active complimentary grant",
            resultingEndLabel:
              grant && !("blocked" in grant)
                ? formatIsleOfManDateTime(grant.endsAt)
                : grant
                  ? "Blocked by a paid subscription"
                  : "Create the campaign first",
          };
        })}
        invites={invites.map((invite) => {
          const status = displayOnboardingStatus(invite.status, invite.expiresAt, now);
          return {
            id: invite.id,
            dealerId: invite.dealerId,
            dealerName: invite.dealer.name,
            recipientEmail: invite.recipientEmailNorm,
            statusLabel: STATUS_LABELS[status],
            canResend: canResendOnboardingInvite(invite.status, invite.expiresAt, now),
            canRevoke: canRevokeOnboardingInvite(invite.status),
            expiresLabel: formatIsleOfManDateTime(invite.expiresAt),
            error: invite.lastError,
          };
        })}
      />
    </>
  );
}
