import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { BLOCKING_ONBOARDING_STATUSES } from "@/lib/dealers/onboarding/statuses";

export class OnboardingIncompleteError extends Error {
  readonly statusCode = 403 as const;

  constructor(message = "Finish dealer onboarding before using this account.") {
    super(message);
    this.name = "OnboardingIncompleteError";
  }
}

export async function findBlockingOnboardingInvite(userId: string) {
  try {
    return await db.dealerOnboardingInvite.findFirst({
      where: { userId, status: { in: [...BLOCKING_ONBOARDING_STATUSES] } },
      select: { id: true, status: true },
    });
  } catch (error) {
    if (isOnboardingTableMissing(error)) return null;
    throw error;
  }
}

function isOnboardingTableMissing(error: unknown) {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2021") {
    return true;
  }
  return (
    error instanceof Error &&
    error.message.includes("DealerOnboardingInvite") &&
    error.message.toLowerCase().includes("does not exist")
  );
}
