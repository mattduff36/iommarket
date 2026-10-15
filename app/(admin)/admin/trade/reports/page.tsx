import { AlertTriangle } from "lucide-react";
import Link from "next/link";
import { AdminPager } from "@/components/admin/admin-pager";
import { adminTotalPages, parseAdminPage } from "@/lib/admin/query";
import { notFound } from "next/navigation";
import { resolveTradeReportAction } from "@/actions/trade/admin";
import { AdminEmptyState } from "@/components/admin/admin-empty-state";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { TradeBackLink, TradeReportBadge, tradeCodeLabel } from "@/components/admin/trade-admin-ui";
import { TradeForm } from "@/components/trade/trade-form";
import { formatAdminDate } from "@/lib/admin/format";
import { db } from "@/lib/db";
import { isTradeExchangeEnabled } from "@/lib/trade-exchange/flag";

export const dynamic = "force-dynamic";

export default async function AdminTradeReportsPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  if (!isTradeExchangeEnabled()) notFound();
  const page = parseAdminPage((await searchParams).page);
  const total = await db.tradeReport.count({ where: { status: "OPEN" } });
  const reports = await db.tradeReport.findMany({
    where: { status: "OPEN" },
    orderBy: { createdAt: "desc" },
    take: 25,
    skip: (page - 1) * 25,
    select: {
      id: true,
      status: true,
      reasonCode: true,
      details: true,
      createdAt: true,
      listing: { select: { id: true, year: true, make: true, model: true } },
    },
  });
  return (
    <section>
      <AdminPageHeader
        title="Trade reports"
        description="Open reports are waiting for a decision."
        actions={<TradeBackLink href="/admin/trade">Trade Exchange</TradeBackLink>}
      />
      {reports.length === 0 ? (
        <AdminEmptyState icon={AlertTriangle} title="No open reports" description="New trade listing reports will appear here." />
      ) : (
        <ul className="space-y-3">
          {reports.map((report) => (
            <li key={report.id} className="rounded-lg border border-border bg-surface p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Link href={`/dealer/trade/listings/${report.listing.id}`} className="font-medium text-text-primary underline underline-offset-4">{report.listing.year} {report.listing.make} {report.listing.model}</Link>
                <TradeReportBadge status={report.status} />
              </div>
              <p className="mt-1 text-sm text-text-secondary">
                {tradeCodeLabel(report.reasonCode)}
                {" · "}
                <time dateTime={report.createdAt.toISOString()}>{formatAdminDate(report.createdAt)}</time>
              </p>
              <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-text-primary">{report.details}</p>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                <TradeForm
                  className="space-y-2"
                  action={resolveTradeReportAction.bind(null, report.id, "RESOLVED")}
                  submitLabel="Resolve"
                  successMessage="Report resolved."
                >
                  <span className="sr-only">Resolve report for {report.listing.year} {report.listing.make} {report.listing.model}</span>
                </TradeForm>
                <TradeForm
                  className="space-y-2"
                  variant="ghost"
                  action={resolveTradeReportAction.bind(null, report.id, "REJECTED")}
                  submitLabel="Reject report"
                  successMessage="Report rejected."
                >
                  <span className="sr-only">Reject report for {report.listing.year} {report.listing.make} {report.listing.model}</span>
                </TradeForm>
              </div>
            </li>
          ))}
        </ul>
      )}
      <AdminPager page={page} totalPages={adminTotalPages(total, 25)} hrefForPage={(next) => `/admin/trade/reports?page=${next}`} />
    </section>
  );
}

