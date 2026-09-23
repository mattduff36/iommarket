import type { Prisma } from "@prisma/client";
import { foundingEmailsForKeys } from "@/lib/dealers/onboarding/founding-allowlist";
import { isPlaceholderAuthUserId, PLACEHOLDER_AUTH_PREFIX } from "@/lib/listings/sample-visibility";
import { isPreviewSystemAuthUserId, PREVIEW_AUTH_USER_ID_PREFIX } from "@/lib/preview-packs/safety";

export interface OnboardingDealerIdentity {
  isAdminPreview: boolean;
  user: {
    email: string;
    authUserId: string | null;
    role: string;
    disabledAt: Date | null;
    deletedAt: Date | null;
  };
}

export function isOnboardingEligibleDealer(
  dealer: OnboardingDealerIdentity,
  enabledPackKeys: readonly string[],
) {
  if (dealer.isAdminPreview) return false;
  if (dealer.user.role !== "DEALER" || dealer.user.disabledAt || dealer.user.deletedAt) return false;
  const authUserId = dealer.user.authUserId;
  if (!authUserId) return false;
  if (isPlaceholderAuthUserId(authUserId) || isPreviewSystemAuthUserId(authUserId)) return false;
  const email = dealer.user.email.trim().toLowerCase();
  return foundingEmailsForKeys(enabledPackKeys).some((item) => item === email);
}

export function onboardingEligibleDealerWhere(
  enabledPackKeys: readonly string[],
  now = new Date(),
): Prisma.DealerProfileWhereInput {
  const emails = foundingEmailsForKeys(enabledPackKeys);
  if (emails.length === 0) return { id: { in: [] } };
  return {
    isAdminPreview: false,
    subscriptions: {
      none: {
        source: "PAYMENT",
        status: "ACTIVE",
        currentPeriodEnd: { gt: now },
      },
    },
    user: {
      role: "DEALER",
      deletedAt: null,
      disabledAt: null,
      AND: [
        {
          OR: emails.map((email) => ({
            email: { equals: email, mode: "insensitive" as const },
          })),
        },
        { NOT: { authUserId: { startsWith: PLACEHOLDER_AUTH_PREFIX } } },
        { NOT: { authUserId: { startsWith: PREVIEW_AUTH_USER_ID_PREFIX } } },
      ],
    },
  };
}
