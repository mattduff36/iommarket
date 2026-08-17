export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
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
    <div>
      <h1 className="text-2xl font-bold text-text-primary mb-6">Fraud Reports</h1>
      <div className="mb-4 flex flex-wrap gap-2 text-sm">
        {STATUS_FILTERS.map((value) => (
          <Link
            key={value}
            href={`/admin/reports?status=${value}`}
            className={value === status ? "text-text-primary" : "text-text-secondary"}
          >
            {value}
          </Link>
        ))}
      </div>
      <div className="space-y-4">
        {reports.map((report) => (
          <div key={report.id} className="relative rounded-lg border border-border p-4 bg-surface">
            <CardOverlayLink
              href={`/listings/${report.listing.id}?adminReview=1`}
              label={report.listing.title}
            />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-medium text-text-primary">{report.listing.title}</p>
                <p className="text-xs text-text-secondary mt-1">
                  {report.reporterEmail} · {report.createdAt.toLocaleDateString("en-GB")}
                  {report.reasonCode ? ` · ${report.reasonCode}` : ""}
                </p>
              </div>
              <Badge variant={STATUS_VARIANT[report.status] ?? "neutral"}>{report.status}</Badge>
            </div>
            <p className="mt-3 text-sm text-text-secondary">{report.reason}</p>
            <div className={`mt-3 max-w-md ${CARD_OVERLAY_CONTROL_CLASS}`}>
              <ReportActions
                reportId={report.id}
                currentStatus={report.status}
                currentAdminNotes={report.adminNotes}
                listingStatus={report.listing.status}
                expectedRevision={report.listing.lifecycleRevision}
                reportReasonCode={report.reasonCode}
              />
            </div>
          </div>
        ))}
      </div>
      <AdminPager
        page={page}
        totalPages={totalPages}
        hrefForPage={(nextPage) => `/admin/reports?status=${status}&page=${nextPage}`}
      />
    </div>
  );
}
