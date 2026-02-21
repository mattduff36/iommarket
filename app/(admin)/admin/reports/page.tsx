export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { Badge } from "@/components/ui/badge";
import { ReportActions } from "./report-actions";

export const metadata: Metadata = { title: "Moderation Reports" };

const STATUS_VARIANT: Record<string, "neutral" | "warning" | "success" | "error" | "info"> = {
  OPEN: "warning",
  REVIEWED: "info",
  ACTIONED: "success",
  DISMISSED: "neutral",
};

export default async function AdminReportsPage() {
  const reports = await db.report.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      listing: {
        select: { id: true, title: true },
      },
    },
  });

  return (
    <div>
      <h1 className="text-2xl font-bold text-text-primary mb-6">Fraud Reports</h1>
      <div className="space-y-4">
        {reports.map((report) => (
          <div key={report.id} className="rounded-lg border border-border p-4 bg-surface">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <Link href={`/listings/${report.listing.id}`} className="font-medium text-text-primary hover:underline">
                  {report.listing.title}
                </Link>
                <p className="text-xs text-text-secondary mt-1">
                  {report.reporterEmail} · {report.createdAt.toLocaleDateString("en-GB")}
                </p>
              </div>
              <Badge variant={STATUS_VARIANT[report.status] ?? "neutral"}>{report.status}</Badge>
            </div>
            <p className="mt-3 text-sm text-text-secondary">{report.reason}</p>
            <div className="mt-3 max-w-md">
              <ReportActions
                reportId={report.id}
                currentStatus={report.status}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
