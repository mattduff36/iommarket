import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { isTradeExchangeEnabled } from "@/lib/trade-exchange/flag";
import { tradeAdminMetrics } from "@/lib/trade-exchange/maintenance";

export default async function AdminTradePage() {
  if (!isTradeExchangeEnabled()) notFound();
  const metrics = await tradeAdminMetrics();
  const cards = [
    ["Applications waiting", metrics.pendingApplications],
    ["Approved businesses", metrics.approvedDealers],
    ["Live trade listings", metrics.liveListings],
    ["Open enquiries", metrics.openEnquiries],
    ["Open reports", metrics.openReports],
    ["Marked sold", metrics.sold],
  ] as const;
  return (
    <section>
      <AdminPageHeader title="Trade Exchange" description="Private dealer stock, verification and moderation." />
      <div className="mb-6 flex flex-wrap gap-3 text-sm">
        <Link className="underline" href="/admin/trade/applications">Applications</Link>
        <Link className="underline" href="/admin/trade/listings">Listings</Link>
        <Link className="underline" href="/admin/trade/reports">Reports</Link>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {cards.map(([label, value]) => (
          <Card key={label}>
            <CardHeader className="pb-2"><CardTitle className="text-sm text-text-secondary">{label}</CardTitle></CardHeader>
            <CardContent><p className="text-2xl font-bold text-text-primary">{value}</p></CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}
