export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { db } from "@/lib/db";
import { formatIsleOfManDateTime } from "@/lib/dealers/onboarding/campaign-window";
import { onboardingEligibleDealerWhere } from "@/lib/dealers/onboarding/eligible-dealers";
import {
  ONBOARDING_PRO_END_LABEL,
  planPromotionGrant,
} from "@/lib/dealers/onboarding/grant-plan";
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

export default async function AdminDealerOnboardingPage({
  searchParams,
}: Props) {
  const params = await searchParams;
  const now = new Date();
  const [enabledPacks, invites] = await Promise.all([
    db.dealerPreviewPack.findMany({
      where: { enabled: true },
      select: { dealerKey: true },
    }),
    db.dealerOnboardingInvite.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { dealer: { select: { name: true } } },
    }),
  ]);
  const dealers = await db.dealerProfile.findMany({
    where: onboardingEligibleDealerWhere(
      enabledPacks.map((pack) => pack.dealerKey),
      now,
      process.env.VERCEL_ENV,
    ),
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
  });
  const dealerOptions = dealers.map((dealer) => {
    const grant = planPromotionGrant({
      subscriptions: dealer.subscriptions,
      now,
    });
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
        "blocked" in grant
          ? grant.blocked === "paid-subscription"
            ? "Blocked by a paid subscription"
            : "Complimentary Pro has ended"
          : grant.kind === "preserve"
            ? formatIsleOfManDateTime(grant.endsAt)
            : ONBOARDING_PRO_END_LABEL,
    };
  });

  return (
    <>
      <h1 className="mb-2 text-2xl font-bold text-text-primary">
        Dealer onboarding
      </h1>
      <p className="mb-6 max-w-3xl text-sm text-text-secondary">
        Send one email that lets a dealer claim an existing account, set a
        password, and accept the account and dealer documents. The profile and
        listings stay on the same account.
      </p>
      <OnboardingManager
        selectedDealerId={
          params.dealer &&
          dealerOptions.some((dealer) => dealer.id === params.dealer)
            ? params.dealer
            : null
        }
        dealers={dealerOptions}
        invites={invites.map((invite) => {
          const status = displayOnboardingStatus(
            invite.status,
            invite.expiresAt,
            now,
          );
          return {
            id: invite.id,
            dealerId: invite.dealerId,
            dealerName: invite.dealer.name,
            recipientEmail: invite.recipientEmailNorm,
            statusLabel: STATUS_LABELS[status],
            canResend: canResendOnboardingInvite(
              invite.status,
              invite.expiresAt,
              now,
            ),
            canRevoke: canRevokeOnboardingInvite(invite.status),
            expiresLabel: formatIsleOfManDateTime(invite.expiresAt),
            error: invite.lastError,
          };
        })}
      />
    </>
  );
}
