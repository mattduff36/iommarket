import { db } from "@/lib/db";
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  isNotificationPreferenceKey,
  type NotificationPreferenceKey,
  type NotificationPreferences,
} from "@/lib/notifications/preferences";

const RECIPIENT_REQUIRED = "A user id or account email is required to check notification preferences.";

export async function readNotificationPreferences(userId: string): Promise<NotificationPreferences> {
  const id = userId.trim();
  if (!id) {
    throw new Error("A user id is required to read notification preferences.");
  }

  const row = await db.userNotificationSettings.findUnique({
    where: { userId: id },
  });
  if (!row) return { ...DEFAULT_NOTIFICATION_PREFERENCES };

  return {
    listingUpdates: row.listingUpdates,
    draftListings: row.draftListings ?? true,
    dealerReviews: row.dealerReviews,
    tradeMessages: row.tradeMessages,
    tradeListingUpdates: row.tradeListingUpdates,
    tradeSavedSearchAlerts: row.tradeSavedSearchAlerts,
  };
}

async function userIdForPrimaryEmail(email: string): Promise<string | null> {
  const account = await db.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
    select: { id: true },
  });
  return account?.id ?? null;
}

export async function isNotificationEnabled(
  category: NotificationPreferenceKey,
  recipient: { userId?: string | null; email?: string | null },
): Promise<boolean> {
  if (!isNotificationPreferenceKey(category)) {
    throw new Error("Unknown notification category.");
  }

  const userId = recipient.userId?.trim() ?? "";
  if (userId) {
    const preferences = await readNotificationPreferences(userId);
    return preferences[category];
  }

  const email = recipient.email?.trim() ?? "";
  if (!email) throw new Error(RECIPIENT_REQUIRED);

  const accountUserId = await userIdForPrimaryEmail(email);
  if (!accountUserId) return true;

  const preferences = await readNotificationPreferences(accountUserId);
  return preferences[category];
}
