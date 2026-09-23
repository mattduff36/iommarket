import type { Prisma } from "@prisma/client";
import {
  foundingEmails,
  foundingEmailsForKeys,
} from "@/lib/dealers/onboarding/founding-allowlist";
import { onboardingTestEmailsForEnvironment } from "@/lib/dealers/onboarding/test-accounts";
import {
  isPlaceholderAuthUserId,
  PLACEHOLDER_AUTH_PREFIX,
} from "@/lib/listings/sample-visibility";
import {
  isPreviewSystemAuthUserId,
  OCEAN_OWNER_EMAIL,
  PREVIEW_AUTH_USER_ID_PREFIX,
} from "@/lib/preview-packs/safety";

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
  environment: string | undefined,
) {
  if (dealer.isAdminPreview) return false;
  if (
    dealer.user.role !== "DEALER" ||
    dealer.user.disabledAt ||
    dealer.user.deletedAt
  )
    return false;
  const authUserId = dealer.user.authUserId;
  if (!authUserId) return false;
  if (
    isPlaceholderAuthUserId(authUserId) ||
    isPreviewSystemAuthUserId(authUserId)
  )
    return false;
  const email = dealer.user.email.trim().toLowerCase();
  return eligibleEmails(enabledPackKeys, environment).some(
    (item) => item === email,
  );
}

export function onboardingEligibleDealerWhere(
  enabledPackKeys: readonly string[],
  now = new Date(),
  environment = process.env.VERCEL_ENV,
): Prisma.DealerProfileWhereInput {
  const emails = eligibleEmails(enabledPackKeys, environment);
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

function eligibleEmails(
  enabledPackKeys: readonly string[],
  environment: string | undefined,
) {
  if (environment === "preview") {
    return [
      ...foundingEmailsForKeys(enabledPackKeys),
      ...onboardingTestEmailsForEnvironment(environment, enabledPackKeys),
    ];
  }
  if (environment === "production") {
    return [
      ...foundingEmails(),
      OCEAN_OWNER_EMAIL,
      ...onboardingTestEmailsForEnvironment(environment, enabledPackKeys),
    ];
  }
  return onboardingTestEmailsForEnvironment(environment, enabledPackKeys);
}
