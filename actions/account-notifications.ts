"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAcceptedUser } from "@/lib/policy/gate";
import { resolveTradeActor } from "@/lib/trade-exchange/access";
import {
  NOTIFICATION_PREFERENCE_KEYS,
  isEligibleTradeMember,
  toTradeDealerSubject,
  visiblePreferenceKeys,
  type NotificationPreferenceKey,
} from "@/lib/notifications/preferences";

const IDENTITY_FIELDS = ["userId", "email", "id"] as const;
const preferenceValueSchema = z.enum(["true", "false"]);

export type NotificationSettingsState = {
  status: "idle" | "success" | "error";
  message: string;
};

function errorState(message: string): NotificationSettingsState {
  return { status: "error", message };
}

function submittedChanges(formData: FormData, allowed: ReadonlySet<NotificationPreferenceKey>) {
  const submitted = NOTIFICATION_PREFERENCE_KEYS.filter((key) => formData.has(key));
  if (submitted.some((key) => !allowed.has(key))) {
    return { error: "Those notification settings are not available for this account." } as const;
  }

  const changes: Partial<Record<NotificationPreferenceKey, boolean>> = {};
  for (const key of submitted) {
    const parsed = preferenceValueSchema.safeParse(formData.get(key));
    if (!parsed.success) {
      return { error: "Choose on or off for each notification setting." } as const;
    }
    changes[key] = parsed.data === "true";
  }

  if (Object.keys(changes).length === 0) {
    return { error: "There are no notification settings to save." } as const;
  }

  return { changes } as const;
}

export async function updateNotificationSettings(
  _previous: NotificationSettingsState,
  formData: FormData,
): Promise<NotificationSettingsState> {
  const user = await requireAcceptedUser("/account/notifications");
  if (IDENTITY_FIELDS.some((field) => formData.has(field))) {
    return errorState("Notification preferences can only be saved for your own account.");
  }

  const actor = await resolveTradeActor(toTradeDealerSubject(user));
  const allowed = new Set(
    visiblePreferenceKeys({
      role: user.role,
      tradeEligible: isEligibleTradeMember(actor),
    }),
  );
  const parsed = submittedChanges(formData, allowed);
  if ("error" in parsed) return errorState(parsed.error ?? "Unable to read notification settings.");

  try {
    await db.userNotificationSettings.upsert({
      where: { userId: user.id },
      create: { userId: user.id, ...parsed.changes },
      update: parsed.changes,
    });
  } catch {
    return errorState("We could not save your notification preferences. Try again.");
  }

  revalidatePath("/account/notifications");
  return {
    status: "success",
    message: "Your notification preferences have been saved.",
  };
}
