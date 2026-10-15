export const dynamic = "force-dynamic";

import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button-variants";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import {
  isEligibleTradeMember,
  notificationSettingsFields,
  toTradeDealerSubject,
  visiblePreferenceKeys,
} from "@/lib/notifications/preferences";
import { readNotificationPreferences } from "@/lib/notifications/settings";
import { requireAcceptedUser } from "@/lib/policy/gate";
import { resolveTradeActor } from "@/lib/trade-exchange/access";
import { NotificationSettingsForm } from "./notification-settings-form";

export default async function AccountNotificationsPage() {
  const user = await requireAcceptedUser("/account/notifications");
  const actor = await resolveTradeActor(toTradeDealerSubject(user));
  const preferences = await readNotificationPreferences(user.id);
  const fields = notificationSettingsFields(
    visiblePreferenceKeys({
      role: user.role,
      tradeEligible: isEligibleTradeMember(actor),
    }),
    preferences,
  );

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="section-heading-accent text-2xl font-bold text-text-primary font-heading sm:text-3xl">
            Notification settings
          </h1>
          <p className="mt-2 text-sm text-text-secondary">
            Choose which optional emails this account receives. Each setting starts on until you turn it off.
          </p>
        </div>
        <Link href="/account" className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>
          Back to account
        </Link>
      </div>

      <Alert status="info" className="mb-6">
        <div className="space-y-2">
          <p>
            Security, payment, and essential account emails stay on.
          </p>
          <p>
            Marketplace buyer enquiries are still delivered. There is no enquiry inbox yet, so that mail cannot be turned off here.
          </p>
          {user.role === "DEALER" ? <p>
            A verified alternate dealer email changes where some dealer mail is sent. These preferences apply to both addresses.
          </p> : null}

        </div>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle>Optional emails</CardTitle>
        </CardHeader>
        <CardContent>
          <NotificationSettingsForm fields={fields} />
        </CardContent>
      </Card>
    </div>
  );
}
