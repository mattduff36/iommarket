import { AlertTriangle, ClipboardList, Clock } from "lucide-react";
import { notFound } from "next/navigation";
import { AdminActionQueue } from "@/components/admin/admin-action-queue";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { TradeMetricStrip, TradeSectionLinks } from "@/components/admin/trade-admin-ui";
import { db } from "@/lib/db";
import { isTradeExchangeEnabled } from "@/lib/trade-exchange/flag";
import { tradeAdminMetrics } from "@/lib/trade-exchange/maintenance";

export const dynamic = "force-dynamic";

export default async function AdminTradePage() {
  if (!isTradeExchangeEnabled()) notFound();
  const [metrics, reviewQueue, needsInfo] = await Promise.all([
    tradeAdminMetrics(),
    db.tradeListing.count({ where: { status: "PENDING_REVIEW" } }),
    db.tradeMembership.count({ where: { status: "NEEDS_INFO" } }),
  ]);

  return (
    <section>
      <AdminPageHeader
        title="Trade Exchange"
        description="Decide waiting applications, close open reports and release listings held for review."
        actions={<TradeSectionLinks />}
      />
      <AdminActionQueue
        items={[
          {
            href: "/admin/trade/applications?status=PENDING",
            label: "Applications waiting",
            count: metrics.pendingApplications,
            subtitle: needsInfo > 0 ? `${needsInfo.toLocaleString("en-GB")} need more information` : "Need a decision",
            icon: ClipboardList,
            tone: "warning",
          },
          {
            href: "/admin/trade/reports",
            label: "Open reports",
            count: metrics.openReports,
            subtitle: "Need a decision",
            icon: AlertTriangle,
            tone: "error",
          },
          {
            href: "/admin/trade/listings",
            label: "Listings in review",
            count: reviewQueue,
            subtitle: "Held stock waiting to be released or removed",
            icon: Clock,
            tone: "warning",
          },
        ]}
      />
      <TradeMetricStrip
        items={[
          { label: "Approved businesses", value: metrics.approvedDealers },
          { label: "Live trade listings", value: metrics.liveListings },
          { label: "Open enquiries", value: metrics.openEnquiries },
          { label: "Marked sold", value: metrics.sold },
        ]}
      />
    </section>
  );
}
