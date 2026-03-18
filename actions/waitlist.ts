"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { checkRateLimit, makeRateLimitKey } from "@/lib/rate-limit";
import {
  joinWaitlistSchema,
  type JoinWaitlistInput,
  type WaitlistInterest,
} from "@/lib/validations/waitlist";
import {
  sendWaitlistAdminNotificationEmail,
  sendWaitlistConfirmationEmail,
} from "@/lib/email/resend";

const WAITLIST_INTEREST_LABELS: Record<WaitlistInterest, string> = {
  BUYING_CARS: "Buying cars",
  SELLING_CARS: "Selling cars",
  DEALER: "Dealer",
};

function formatWaitlistInterests(interests: WaitlistInterest[]): string[] {
  return interests.map((interest) => WAITLIST_INTEREST_LABELS[interest] ?? interest);
}

export async function joinWaitlist(input: JoinWaitlistInput) {
  const parsed = joinWaitlistSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.flatten().fieldErrors };
  }

  const rateCheck = checkRateLimit(makeRateLimitKey("waitlist", parsed.data.email), {
    windowMs: 300_000,
    maxRequests: 5,
  });
  if (!rateCheck.allowed) {
    return { error: "Too many submissions. Please try again shortly." };
  }

  const interests = parsed.data.interests;
  const interestLabels = formatWaitlistInterests(interests);

  try {
    const waitlistUser = await db.waitlistUser.upsert({
      where: { email: parsed.data.email },
      create: {
        email: parsed.data.email,
        interests,
        source: parsed.data.source,
      },
      update: {
        interests,
        source: parsed.data.source,
      },
    });

    await Promise.allSettled([
      sendWaitlistConfirmationEmail({
        to: waitlistUser.email,
        interests: interestLabels,
      }),
      sendWaitlistAdminNotificationEmail({
        email: waitlistUser.email,
        interests: interestLabels,
        createdAt: waitlistUser.createdAt,
        source: waitlistUser.source,
      }),
    ]);

    return { data: { id: waitlistUser.id } };
  } catch (err) {
    // Avoid leaking internal database/runtime details to public users.
    return {
      error:
        err instanceof Error && err.message.includes("WaitlistUser")
          ? "Waitlist is currently being prepared. Please try again in a minute."
          : "Unable to join the waitlist right now. Please try again shortly.",
    };
  }
}

export async function deleteWaitlistUser(id: string) {
  await requireRole("ADMIN");

  if (!id || typeof id !== "string") {
    return { error: "Invalid ID." };
  }

  try {
    await db.waitlistUser.delete({ where: { id } });
    revalidatePath("/admin/waitlist");
    return { success: true };
  } catch (err) {
    return {
      error:
        err instanceof Error && err.message.includes("Record to delete does not exist")
          ? "Entry not found."
          : "Failed to delete entry. Please try again.",
    };
  }
}
