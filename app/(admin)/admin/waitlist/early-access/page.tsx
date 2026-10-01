export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { db } from "@/lib/db";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { buildWaitlistEarlyAccessEmail } from "@/lib/email/waitlist-early-access";
import { shouldEnforceLaunchGate } from "@/lib/launch/gate";
import {
  EARLY_ACCESS_CAMPAIGN_KEY,
  earlyAccessAudienceWhere,
} from "@/lib/waitlist/early-access/audience";
import { canSendEarlyAccessBulk, canSendEarlyAccessTest } from "@/lib/waitlist/early-access/guard";
import { EarlyAccessCampaignPanel } from "./campaign-panel";

export const metadata: Metadata = { title: "Early access | Admin" };

export default async function EarlyAccessCampaignPage() {
  const [eligibleCount, campaign] = await Promise.all([
    db.waitlistUser.count({ where: earlyAccessAudienceWhere() }),
    db.waitlistEarlyAccessCampaign.findUnique({ where: { key: EARLY_ACCESS_CAMPAIGN_KEY } }),
  ]);
  const body = campaign?.bodyText ?? "";
  const preview = body
    ? buildWaitlistEarlyAccessEmail({
        bodyText: body,
        claimUrl: "https://itrader.im/early-access",
      })
    : null;
  const previewWithoutGate = process.env.VERCEL_ENV === "preview" && !shouldEnforceLaunchGate();

  return (
    <>
      <AdminPageHeader
        title="Early access"
        description="Invite consented car buyers and sellers before public launch. Bulk delivery is production-only."
      />
      <EarlyAccessCampaignPanel
        initialBody={body}
        eligibleCount={eligibleCount}
        status={campaign?.status ?? "NONE"}
        counts={{
          total: campaign?.recipientTotal ?? 0,
          sent: campaign?.sentCount ?? 0,
          failed: campaign?.failedCount ?? 0,
          skipped: campaign?.skippedCount ?? 0,
        }}
        bulkAllowed={canSendEarlyAccessBulk()}
        testAllowed={canSendEarlyAccessTest()}
        previewWithoutGate={previewWithoutGate}
      />
      {preview ? (
        <section className="mt-8">
          <h2 className="mb-3 text-lg font-semibold text-text-primary">Email preview</h2>
          <iframe
            title="Early access email preview"
            sandbox=""
            className="h-[640px] w-full rounded-xl border border-border bg-black"
            srcDoc={preview.html}
          />
        </section>
      ) : null}
    </>
  );
}
