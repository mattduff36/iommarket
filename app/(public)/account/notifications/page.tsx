import { AdminPageHeader } from "@/components/admin/admin-page-header";
export const dynamic = "force-dynamic";

import Link from "@/components/navigation/link";
import { Alert } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
    <div>
      <AdminPageHeader title="Notification settings"
          description="Choose which optional emails this account receives. Each setting starts on until you turn it off." />

      <Alert status="info" className="mb-6">
        <div className="space-y-2">
          <p>
            Security, payment, and essential account emails stay on. Marketplace buyer enquiries are still delivered and cannot be turned off here, because there is no enquiry inbox yet.
          </p>
          {user.role === "DEALER" ? (
            <p>
              A verified alternate dealer email changes where some dealer mail is sent. These preferences apply to both addresses.{" "}
              <Link href="/dealer/email-settings" className="text-text-trust hover:underline">
                Email delivery
              </Link>
            </p>
          ) : null}
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
