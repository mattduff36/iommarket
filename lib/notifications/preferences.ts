import type { TradeDealerSubject } from "@/lib/trade-exchange/decision";

export const NOTIFICATION_PREFERENCE_KEYS = [
  "listingUpdates",
  "draftListings",
  "dealerReviews",
  "tradeMessages",
  "tradeListingUpdates",
  "tradeSavedSearchAlerts",
] as const;

export type NotificationPreferenceKey = (typeof NOTIFICATION_PREFERENCE_KEYS)[number];

export type NotificationPreferences = Record<NotificationPreferenceKey, boolean>;

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  listingUpdates: true,
  draftListings: true,
  dealerReviews: true,
  tradeMessages: true,
  tradeListingUpdates: true,
  tradeSavedSearchAlerts: true,
};

export const NOTIFICATION_CATEGORY_COPY: Record<
  NotificationPreferenceKey,
  { label: string; description: string }
> = {
  listingUpdates: {
    label: "Listing updates",
    description: "Emails about changes to your marketplace listings.",
  },
  draftListings: {
    label: "New draft listings",
    description: "Emails when new listings or changes are sent to your drafts for review.",
  },
  dealerReviews: {
    label: "Dealer reviews",
    description: "Emails about reviews on your dealer profile.",
  },
  tradeMessages: {
    label: "Trade messages",
    description: "Emails when another Trade Exchange member messages you.",
  },
  tradeListingUpdates: {
    label: "Trade listing updates",
    description: "Emails when your Trade Exchange listings change.",
  },
  tradeSavedSearchAlerts: {
    label: "Trade saved-search alerts",
    description: "Emails when a saved Trade Exchange search has new matches.",
  },
};

const TRADE_PREFERENCE_KEYS: NotificationPreferenceKey[] = [
  "tradeMessages",
  "tradeListingUpdates",
  "tradeSavedSearchAlerts",
];

export function isNotificationPreferenceKey(value: string): value is NotificationPreferenceKey {
  return (NOTIFICATION_PREFERENCE_KEYS as readonly string[]).includes(value);
}

export function isEligibleTradeMember(actor: { kind: string }): boolean {
  return actor.kind === "member";
}

export function visiblePreferenceKeys(actor: {
  role: "USER" | "DEALER" | "ADMIN";
  tradeEligible: boolean;
}): NotificationPreferenceKey[] {
  const keys: NotificationPreferenceKey[] = ["listingUpdates", "draftListings"];
  if (actor.role === "DEALER") keys.push("dealerReviews");
  if (actor.tradeEligible) keys.push(...TRADE_PREFERENCE_KEYS);
  return keys;
}

export function toTradeDealerSubject(user: {
  id: string;
  role: "USER" | "DEALER" | "ADMIN";
  disabledAt: Date | null;
  deletedAt: Date | null;
  dealerProfile: { id: string; name: string; tier: "STARTER" | "PRO" } | null;
}): TradeDealerSubject {
  return {
    id: user.id,
    role: user.role,
    disabledAt: user.disabledAt,
    deletedAt: user.deletedAt,
    dealerProfile: user.dealerProfile
      ? {
          id: user.dealerProfile.id,
          name: user.dealerProfile.name,
          tier: user.dealerProfile.tier,
        }
      : null,
  };
}

export function notificationSettingsFields(
  keys: readonly NotificationPreferenceKey[],
  preferences: NotificationPreferences,
) {
  return keys.map((key) => ({
    key,
    label: NOTIFICATION_CATEGORY_COPY[key].label,
    description: NOTIFICATION_CATEGORY_COPY[key].description,
    enabled: preferences[key],
  }));
}
