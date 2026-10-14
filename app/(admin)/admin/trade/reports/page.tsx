import { notFound } from "next/navigation";
import { resolveTradeReportAction } from "@/actions/trade/admin";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { Button } from "@/components/ui/button";
import { db } from "@/lib/db";
import { isTradeExchangeEnabled } from "@/lib/trade-exchange/flag";

export default async function AdminTradeReportsPage() {
  if (!isTradeExchangeEnabled()) notFound();
  const reports = await db.tradeReport.findMany({
    where: { status: "OPEN" },
    orderBy: { createdAt: "desc" },
    select: { id: true, reasonCode: true, details: true, listing: { select: { year: true, make: true, model: true } } },
  });
  return (
    <section>
      <AdminPageHeader title="Trade reports" description="Open reports are waiting for a decision." />
      <ul className="space-y-3">
        {reports.length === 0 ? <li className="text-sm text-text-secondary">No open reports.</li> : reports.map((report) => (
          <li key={report.id} className="rounded-xl border border-border p-4">
            <p className="font-medium">{report.listing.year} {report.listing.make} {report.listing.model}</p>
            <p className="text-sm text-text-secondary">{report.reasonCode}</p>
            <p className="mt-2 text-sm">{report.details}</p>
            <div className="mt-3 flex gap-2">
              <form action={async () => { await resolveTradeReportAction(report.id, "RESOLVED"); }}><Button type="submit">Resolve</Button></form>
              <form action={async () => { await resolveTradeReportAction(report.id, "REJECTED"); }}><Button type="submit" variant="ghost">Reject report</Button></form>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
