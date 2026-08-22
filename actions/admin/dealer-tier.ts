"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { logAdminAction } from "@/lib/admin/audit";
import { getPaidSubscriptionEntitlementWhere } from "@/lib/dealers/entitlement";
import { captureException } from "@/lib/monitoring";
import {
  setDealerTierSchema,
  type SetDealerTierInput,
} from "@/lib/validations/admin";

const TIER_CHANGE_TRANSACTION_ATTEMPTS = 3;

type SetDealerTierResult =
  | { kind: "not-found" }
  | { kind: "no-profile" }
  | { kind: "paid-blocked" }
  | { kind: "updated"; tier: SetDealerTierInput["tier"] };

export async function setDealerTier(input: SetDealerTierInput) {
  const admin = await requireRole("ADMIN");
  const parsed = setDealerTierSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.flatten().fieldErrors };

  const { userId, tier } = parsed.data;
  const now = new Date();

  try {
    const result = await runSetDealerTierTransaction({
      userId,
      tier,
      adminId: admin.id,
      now,
    });
    if (result.kind === "not-found") return { error: "User not found" };
    if (result.kind === "no-profile") {
      return { error: "This account has no dealer profile." };
    }
    if (result.kind === "paid-blocked") {
      return {
        error: "Package is set by the paid subscription and cannot be changed.",
      };
    }

    revalidateDealerPackagePaths(userId);
    return { data: { tier: result.tier } };
  } catch (err) {
    await captureException({
      source: "SERVER",
      error: err,
      action: "setDealerTier",
      route: "/admin/users",
      requestPath: "/admin/users",
      userId: admin.id,
      tags: { userId, tier },
    });
    return { error: "Failed to update dealer package" };
  }
}

async function runSetDealerTierTransaction(input: {
  userId: string;
  tier: SetDealerTierInput["tier"];
  adminId: string;
  now: Date;
}): Promise<SetDealerTierResult> {
  let lastError: unknown;

  for (
    let attempt = 0;
    attempt < TIER_CHANGE_TRANSACTION_ATTEMPTS;
    attempt += 1
  ) {
    try {
      return await db.$transaction(
        async (tx) => {
          const targetUser = await tx.user.findUnique({
            where: { id: input.userId },
            select: {
              id: true,
              dealerProfile: { select: { id: true, tier: true } },
            },
          });
          if (!targetUser) return { kind: "not-found" };
          if (!targetUser.dealerProfile) return { kind: "no-profile" };

          const paidSubscription = await tx.subscription.findFirst({
            where: {
              dealerId: targetUser.dealerProfile.id,
              ...getPaidSubscriptionEntitlementWhere(input.now),
            },
            select: { id: true },
          });
          if (paidSubscription) return { kind: "paid-blocked" };

          const previousTier = targetUser.dealerProfile.tier;
          await tx.dealerProfile.update({
            where: { id: targetUser.dealerProfile.id },
            data: { tier: input.tier },
          });

          await logAdminAction(
            {
              adminId: input.adminId,
              action: "SET_DEALER_TIER",
              entityType: "DealerProfile",
              entityId: targetUser.dealerProfile.id,
              details: {
                userId: input.userId,
                dealerId: targetUser.dealerProfile.id,
                previousTier,
                nextTier: input.tier,
                paidBlocked: false,
              },
            },
            tx,
          );

          return { kind: "updated", tier: input.tier };
        },
        { isolationLevel: "Serializable" }
      );
    } catch (error) {
      lastError = error;
      if (!isRetryableTransactionError(error)) throw error;
    }
  }

  throw lastError;
}

function revalidateDealerPackagePaths(userId: string) {
  revalidatePath("/admin/users");
  revalidatePath(`/admin/users/${userId}`);
  revalidatePath("/admin/dealers");
  revalidatePath("/sell/dealer");
  revalidatePath("/dealer/subscribe");
  revalidatePath("/dealer/dashboard");
  revalidatePath("/dealer/profile");
  revalidatePath("/account");
}

function isRetryableTransactionError(error: unknown) {
  return (
    error instanceof Error &&
    (error.message.includes("P2002") || error.message.includes("P2034"))
  );
}
