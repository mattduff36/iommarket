import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getEmailAppOrigin } from "@/lib/email/links";
import { buildDealerUpgradeOfferEmail } from "@/lib/email/dealer-upgrade";
import { sendStrictResendEmail } from "@/lib/email/send-strict";
import { provisionDealerProfile } from "@/lib/dealers/access";
import { grantAdminDealerAccess } from "@/lib/dealers/entitlement";
import { recordAcceptance } from "@/lib/policy/acceptance";
import { buildDealerUpgradePolicySnapshot } from "@/lib/dealers/upgrade-policy";

const TRANSACTION_ATTEMPTS = 3;
const EMAIL_CLAIM_TTL_MS = 5 * 60_000;

function isRetryableTransactionError(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === "P2002" || error.code === "P2034")
  );
}

export async function createPendingDealerUpgradeOffer(input: {
  userId: string;
  adminId: string;
  durationDays: number;
}) {
  let lastError: unknown;

  for (let attempt = 0; attempt < TRANSACTION_ATTEMPTS; attempt += 1) {
    try {
      return await db.$transaction(
        async (tx) => {
          const user = await tx.user.findUnique({
            where: { id: input.userId },
            select: {
              id: true,
              email: true,
              name: true,
              role: true,
              disabledAt: true,
              deletedAt: true,
              dealerProfile: { select: { id: true } },
            },
          });
          if (!user) return { kind: "not-found" as const };
          if (user.role !== "USER") return { kind: "not-private-user" as const };
          if (user.disabledAt || user.deletedAt) {
            return { kind: "unavailable" as const };
          }

          const now = new Date();
          const claimCutoff = new Date(now.getTime() - EMAIL_CLAIM_TTL_MS);
          const existing = await tx.dealerUpgradeOffer.findFirst({
            where: { userId: user.id, status: "PENDING" },
            select: { id: true, emailClaimedAt: true },
          });
          if (existing?.emailClaimedAt && existing.emailClaimedAt >= claimCutoff) {
            return { kind: "delivery-in-progress" as const };
          }
          const cancelled = await tx.dealerUpgradeOffer.updateMany({
            where: {
              userId: user.id,
              status: "PENDING",
              OR: [
                { emailClaimedAt: null },
                { emailClaimedAt: { lt: claimCutoff } },
              ],
            },
            data: {
              status: "CANCELLED",
              cancelledAt: now,
              cancelledByAdminId: input.adminId,
              emailClaimedAt: null,
              emailClaimToken: null,
            },
          });
          if (existing && cancelled.count !== 1) {
            return { kind: "delivery-in-progress" as const };
          }
          const offer = await tx.dealerUpgradeOffer.create({
            data: {
              userId: user.id,
              createdByAdminId: input.adminId,
              durationDays: input.durationDays,
            },
          });
          return { kind: "created" as const, offer, user };
        },
        { isolationLevel: "Serializable" },
      );
    } catch (error) {
      lastError = error;
      if (!isRetryableTransactionError(error)) throw error;
    }
  }

  throw lastError;
}

function safeDeliveryError(error: unknown) {
  const message = error instanceof Error ? error.message : "Email delivery failed.";
  return message.slice(0, 500);
}

export async function deliverDealerUpgradeOffer(offerId: string) {
  const now = new Date();
  const claimToken = randomUUID();
  const claimCutoff = new Date(now.getTime() - EMAIL_CLAIM_TTL_MS);
  const claimed = await db.dealerUpgradeOffer.updateMany({
    where: {
      id: offerId,
      status: "PENDING",
      OR: [
        { emailClaimedAt: null },
        { emailClaimedAt: { lt: claimCutoff } },
      ],
    },
    data: { emailClaimedAt: now, emailClaimToken: claimToken },
  });
  if (claimed.count !== 1) {
    return { kind: "not-pending" as const };
  }

  const offer = await db.dealerUpgradeOffer.findUnique({
    where: { id: offerId },
    include: {
      user: { select: { email: true, name: true } },
    },
  });
  if (
    !offer ||
    offer.status !== "PENDING" ||
    offer.emailClaimToken !== claimToken
  ) {
    return { kind: "not-pending" as const };
  }

  const acceptanceUrl = new URL("/account/dealer-upgrade", getEmailAppOrigin());
  acceptanceUrl.searchParams.set("offer", offer.id);
  const email = buildDealerUpgradeOfferEmail({
    accountName: offer.user.name ?? offer.user.email,
    acceptanceUrl: acceptanceUrl.toString(),
    durationDays: offer.durationDays,
  });

  try {
    const sent = await sendStrictResendEmail({
      to: offer.user.email,
      subject: email.subject,
      text: email.text,
      html: email.html,
      headers: {
        "X-Entity-Ref-ID": `dealer-upgrade-${offer.id}-${offer.updatedAt.getTime()}`,
      },
    });
    const saved = await db.dealerUpgradeOffer.updateMany({
      where: {
        id: offer.id,
        status: "PENDING",
        emailClaimToken: claimToken,
      },
      data: {
        emailSentAt: new Date(),
        emailMessageId: sent.id,
        emailLastError: null,
        emailClaimedAt: null,
        emailClaimToken: null,
      },
    });
    if (saved.count !== 1) {
      return { kind: "tracking-failed" as const };
    }
    return { kind: "sent" as const };
  } catch (error) {
    const message = safeDeliveryError(error);
    await db.dealerUpgradeOffer.updateMany({
      where: {
        id: offer.id,
        status: "PENDING",
        emailClaimToken: claimToken,
      },
      data: {
        emailLastError: message,
        emailClaimedAt: null,
        emailClaimToken: null,
      },
    });
    return { kind: "failed" as const, message };
  }
}

export async function acceptPendingDealerUpgradeOffer(input: {
  userId: string;
  offerId: string;
  policyDigest: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const policy = buildDealerUpgradePolicySnapshot();
  let lastError: unknown;

  for (let attempt = 0; attempt < TRANSACTION_ATTEMPTS; attempt += 1) {
    try {
      return await db.$transaction(
        async (tx) => {
          const user = await tx.user.findUnique({
            where: { id: input.userId },
            select: {
              id: true,
              email: true,
              name: true,
              role: true,
              disabledAt: true,
              deletedAt: true,
              dealerProfile: { select: { id: true } },
            },
          });
          if (!user || user.disabledAt || user.deletedAt) {
            return { kind: "unavailable" as const };
          }

          const accepted = await tx.dealerUpgradeAcceptance.findUnique({
            where: { offerId: input.offerId },
            select: { id: true, userId: true },
          });
          if (accepted) {
            return accepted.userId === user.id && user.role === "DEALER"
              ? { kind: "already-accepted" as const }
              : { kind: "not-pending" as const };
          }

          const offer = await tx.dealerUpgradeOffer.findFirst({
            where: {
              id: input.offerId,
              userId: user.id,
              status: "PENDING",
            },
          });
          if (!offer) return { kind: "not-pending" as const };
          if (policy.digest !== input.policyDigest) {
            return { kind: "policy-changed" as const };
          }
          if (user.role !== "USER") return { kind: "role-conflict" as const };

          const paidSubscription = user.dealerProfile
            ? await tx.subscription.findFirst({
                where: {
                  dealerId: user.dealerProfile.id,
                  source: "PAYMENT",
                  status: "ACTIVE",
                  currentPeriodEnd: { gt: now },
                },
                select: { id: true },
              })
            : null;
          if (paidSubscription) return { kind: "paid-conflict" as const };
          const activeAdminGrant = user.dealerProfile
            ? await tx.subscription.findFirst({
                where: {
                  dealerId: user.dealerProfile.id,
                  source: "ADMIN_GRANT",
                  status: "ACTIVE",
                  revokedAt: null,
                  grantStartsAt: { lte: now },
                  grantEndsAt: { gt: now },
                },
                select: { id: true },
              })
            : null;
          if (activeAdminGrant) {
            return { kind: "admin-grant-conflict" as const };
          }

          const dealerProfile = await provisionDealerProfile(tx, user);
          await recordAcceptance(tx, {
            userId: user.id,
            acceptanceType: "DEALER_BUNDLE",
            source: "ADMIN_UPGRADE",
          });
          const grant = await grantAdminDealerAccess(tx, {
            dealerId: dealerProfile.id,
            adminId: offer.createdByAdminId,
            durationDays: offer.durationDays,
            now,
          });
          if (grant.kind === "paid-access-preserved") {
            throw new Error("Paid dealer access changed during upgrade activation.");
          }
          const expectedGrantEnd = new Date(
            now.getTime() + offer.durationDays * 86_400_000,
          );
          if (
            grant.subscription.grantStartsAt?.getTime() !== now.getTime() ||
            grant.subscription.grantEndsAt?.getTime() !== expectedGrantEnd.getTime()
          ) {
            throw new Error("Dealer grant duration did not match the accepted offer.");
          }
          await tx.dealerUpgradeAcceptance.create({
            data: {
              offerId: offer.id,
              userId: user.id,
              source: "ADMIN_UPGRADE",
              bundleVersion: policy.bundleVersion,
              policyVersions: policy.policyVersions,
              contentHashes: policy.contentHashes,
              acceptedAt: now,
            },
          });
          const roleUpdate = await tx.user.updateMany({
            where: { id: user.id, role: "USER" },
            data: { role: "DEALER" },
          });
          const offerUpdate = await tx.dealerUpgradeOffer.updateMany({
            where: { id: offer.id, status: "PENDING" },
            data: {
              status: "ACCEPTED",
              acceptedAt: now,
              emailClaimedAt: null,
              emailClaimToken: null,
            },
          });
          if (roleUpdate.count !== 1 || offerUpdate.count !== 1) {
            throw new Error("Dealer upgrade state changed during activation.");
          }

          return {
            kind: "accepted" as const,
            dealerId: dealerProfile.id,
            grantEndsAt: grant.subscription.grantEndsAt,
          };
        },
        { isolationLevel: "Serializable" },
      );
    } catch (error) {
      lastError = error;
      if (!isRetryableTransactionError(error)) throw error;
    }
  }

  throw lastError;
}

export async function cancelPendingDealerUpgradeOffer(
  offerId: string,
  adminId: string,
) {
  const now = new Date();
  const claimCutoff = new Date(now.getTime() - EMAIL_CLAIM_TTL_MS);
  return db.dealerUpgradeOffer.updateMany({
    where: {
      id: offerId,
      status: "PENDING",
      OR: [
        { emailClaimToken: null },
        { emailClaimedAt: { lt: claimCutoff } },
      ],
    },
    data: {
      status: "CANCELLED",
      cancelledAt: now,
      cancelledByAdminId: adminId,
      emailClaimedAt: null,
      emailClaimToken: null,
    },
  });
}

export async function findPendingDealerUpgradeOffer(userId: string) {
  return db.dealerUpgradeOffer.findFirst({
    where: { userId, status: "PENDING" },
    orderBy: { createdAt: "desc" },
  });
}

export async function findPendingDealerUpgradeOfferById(
  offerId: string,
  userId?: string,
) {
  return db.dealerUpgradeOffer.findFirst({
    where: {
      id: offerId,
      status: "PENDING",
      ...(userId ? { userId } : {}),
    },
  });
}
