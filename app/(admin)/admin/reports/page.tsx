export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { db } from "@/lib/db";
import { ShieldCheck } from "lucide-react";
import { AdminEmptyState } from "@/components/admin/admin-empty-state";
import {
  AdminFilterBar,
  AdminFilterChip,
} from "@/components/admin/admin-filter-bar";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { Badge } from "@/components/ui/badge";
import {
  CARD_OVERLAY_CONTROL_CLASS,
  CardOverlayLink,
} from "@/components/ui/card-overlay-link";
import { ReportActions } from "./report-actions";
import { AdminPager } from "@/components/admin/admin-pager";
import { adminTotalPages, parseAdminPage } from "@/lib/admin/query";

export const metadata: Metadata = { title: "Moderation Reports" };

const PAGE_SIZE = 25;
const STATUS_FILTERS = ["OPEN", "REVIEWED", "ACTIONED", "DISMISSED", "ALL"] as const;

const STATUS_VARIANT: Record<string, "neutral" | "warning" | "success" | "error" | "info"> = {
  OPEN: "warning",
  REVIEWED: "info",
  ACTIONED: "success",
  DISMISSED: "neutral",
};

export default async function AdminReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string }>;
}) {
  const params = await searchParams;
  const status = STATUS_FILTERS.includes(params.status as (typeof STATUS_FILTERS)[number])
    ? (params.status as (typeof STATUS_FILTERS)[number])
    : "OPEN";
  const page = parseAdminPage(params.page);
  const where = status === "ALL" ? {} : { status };

  const [reports, total] = await Promise.all([
    db.report.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        listing: {
          select: { id: true, title: true, status: true, lifecycleRevision: true },
        },
      },
    }),
    db.report.count({ where }),
  ]);
  const totalPages = adminTotalPages(total, PAGE_SIZE);

  return (
    <>
      <AdminPageHeader
        title="Fraud reports"
        description="Review reported listings, record the decision, and take down unsafe content when required."
      />
      <AdminFilterBar count={`${total} ${total === 1 ? "report" : "reports"}`}>
        {STATUS_FILTERS.map((value) => (
          <AdminFilterChip
            key={value}
            href={`/admin/reports?status=${value}`}
            active={value === status}
            activeTone={
              value === "OPEN"
                ? "warning"
                : value === "ACTIONED"
                  ? "success"
                  : "neutral"
            }
          >
            {value}
          </AdminFilterChip>
        ))}
      </AdminFilterBar>
      <div className="space-y-3">
        {reports.map((report) => (
          <article
            key={report.id}
            className="relative overflow-hidden rounded-lg border border-border bg-surface p-4 shadow-low"
          >
            <CardOverlayLink
              href={`/listings/${report.listing.id}?adminReview=1`}
              label={report.listing.title}
            />
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium text-text-primary">{report.listing.title}</p>
                <p className="mt-1 text-xs leading-5 text-text-tertiary">
                  {report.reporterEmail} · {report.createdAt.toLocaleDateString("en-GB")}
                  {report.reasonCode ? ` · ${report.reasonCode}` : ""}
                </p>
              </div>
              <Badge variant={STATUS_VARIANT[report.status] ?? "neutral"}>{report.status}</Badge>
            </div>
            <p className="mt-3 max-w-3xl whitespace-pre-wrap text-sm leading-6 text-text-secondary">
              {report.reason}
            </p>
            <div className={`mt-4 max-w-xl ${CARD_OVERLAY_CONTROL_CLASS}`}>
              <ReportActions
                reportId={report.id}
                currentStatus={report.status}
                currentAdminNotes={report.adminNotes}
                listingStatus={report.listing.status}
                expectedRevision={report.listing.lifecycleRevision}
                reportReasonCode={report.reasonCode}
              />
            </div>
          </article>
        ))}
        {reports.length === 0 ? (
          <AdminEmptyState
            icon={ShieldCheck}
            title={status === "OPEN" ? "No open reports" : "No reports match this status"}
            description={
              status === "OPEN"
                ? "The fraud-report queue is clear."
                : "Choose another status to review a different part of the queue."
            }
          />
        ) : null}
      </div>
      <AdminPager
        page={page}
        totalPages={totalPages}
        hrefForPage={(nextPage) => `/admin/reports?status=${status}&page=${nextPage}`}
      />
    </>
  );
}
