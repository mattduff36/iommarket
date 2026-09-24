export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { AdminEmptyState } from "@/components/admin/admin-empty-state";
import {
  AdminFilterBar,
  AdminFilterChip,
  adminSearchButtonClass,
  adminSearchInputClass,
} from "@/components/admin/admin-filter-bar";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { MonitoringIssueCard } from "@/components/admin/monitoring-issue-card";

export const metadata: Metadata = { title: "Monitoring | Admin" };

const STATUS_OPTIONS = ["OPEN", "ACKNOWLEDGED", "MUTED", "RESOLVED"] as const;
const SEVERITY_OPTIONS = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
const SOURCE_OPTIONS = ["SERVER", "CLIENT", "WEBHOOK", "BUSINESS"] as const;

function buildFilterHref(params: {
  status?: string;
  severity?: string;
  source?: string;
  q?: string;
}) {
  const sp = new URLSearchParams();
  if (params.status) sp.set("status", params.status);
  if (params.severity) sp.set("severity", params.severity);
  if (params.source) sp.set("source", params.source);
  if (params.q) sp.set("q", params.q);
  const query = sp.toString();
  return query ? `/admin/monitoring?${query}` : "/admin/monitoring";
}

interface Props {
  searchParams?: Promise<{
    status?: string;
    severity?: string;
    source?: string;
    q?: string;
  }>;
}

export default async function AdminMonitoringPage({ searchParams }: Props) {
  const { expireMutedMonitoringIssues } = await import("@/lib/monitoring/mute-expiry");
  await expireMutedMonitoringIssues();
  const params = searchParams ? await searchParams : {};
  const status = STATUS_OPTIONS.includes(params.status as (typeof STATUS_OPTIONS)[number])
    ? (params.status as (typeof STATUS_OPTIONS)[number])
    : undefined;
  const severity = SEVERITY_OPTIONS.includes(params.severity as (typeof SEVERITY_OPTIONS)[number])
    ? (params.severity as (typeof SEVERITY_OPTIONS)[number])
    : undefined;
  const source = SOURCE_OPTIONS.includes(params.source as (typeof SOURCE_OPTIONS)[number])
    ? (params.source as (typeof SOURCE_OPTIONS)[number])
    : undefined;
  const q = params.q?.trim();

  const where: Prisma.MonitoringIssueWhereInput = {
    ...(status ? { status } : {}),
    ...(severity ? { severity } : {}),
    ...(source ? { source } : {}),
    ...(q
      ? {
          OR: [
            { title: { contains: q, mode: "insensitive" } },
            { sampleMessage: { contains: q, mode: "insensitive" } },
            { sampleRoute: { contains: q, mode: "insensitive" } },
            { sampleAction: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const [issues, openCount, criticalOpenCount] = await Promise.all([
    db.monitoringIssue.findMany({
      where,
      orderBy: [{ severity: "desc" }, { lastSeenAt: "desc" }],
      take: 200,
      include: {
        _count: { select: { events: true } },
        statusEvents: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: {
            toStatus: true,
            notes: true,
            createdAt: true,
          },
        },
      },
    }),
    db.monitoringIssue.count({ where: { status: "OPEN" } }),
    db.monitoringIssue.count({
      where: { status: { in: ["OPEN", "ACKNOWLEDGED"] }, severity: "CRITICAL" },
    }),
  ]);

  return (
    <>
      <AdminPageHeader
        title="Monitoring"
        description="Centralized error and anomaly triage for production and staging issues."
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-border bg-surface p-4 shadow-low">
          <p className="text-xs uppercase tracking-wider text-text-tertiary">Open Issues</p>
          <p className="mt-2 text-2xl font-bold text-text-primary">{openCount}</p>
        </div>
        <div className="rounded-lg border border-border bg-surface p-4 shadow-low">
          <p className="text-xs uppercase tracking-wider text-text-tertiary">Critical Active</p>
          <p className="mt-2 text-2xl font-bold text-text-energy">{criticalOpenCount}</p>
        </div>
      </div>

      <AdminFilterBar
        count={`${issues.length} matching ${issues.length === 1 ? "issue" : "issues"}`}
      >
        <form
          action="/admin/monitoring"
          method="get"
          className="flex min-w-0 gap-2"
        >
          <input
            name="q"
            defaultValue={q}
            placeholder="Search issues..."
            aria-label="Search monitoring issues"
            className={adminSearchInputClass}
          />
          {status ? <input type="hidden" name="status" value={status} /> : null}
          {severity ? <input type="hidden" name="severity" value={severity} /> : null}
          {source ? <input type="hidden" name="source" value={source} /> : null}
          <button type="submit" className={adminSearchButtonClass}>
            Search
          </button>
        </form>

        <div className="flex flex-wrap gap-1" aria-label="Issue status">
          <AdminFilterChip
            href={buildFilterHref({ q })}
            active={!status && !severity && !source}
          >
            All
          </AdminFilterChip>
          {STATUS_OPTIONS.map((option) => (
            <AdminFilterChip
              key={option}
              href={buildFilterHref({ status: option, severity, source, q })}
              active={status === option}
            >
              {option}
            </AdminFilterChip>
          ))}
        </div>

        <div className="flex flex-wrap gap-1" aria-label="Issue severity and source">
          {SEVERITY_OPTIONS.map((option) => (
            <AdminFilterChip
              key={option}
              href={buildFilterHref({ status, severity: option, source, q })}
              active={severity === option}
              activeTone="warning"
            >
              {option}
            </AdminFilterChip>
          ))}
          {SOURCE_OPTIONS.map((option) => (
            <AdminFilterChip
              key={option}
              href={buildFilterHref({ status, severity, source: option, q })}
              active={source === option}
              activeTone="success"
            >
              {option}
            </AdminFilterChip>
          ))}
        </div>
      </AdminFilterBar>

      <div className="space-y-3">
        {issues.map((issue) => (
          <MonitoringIssueCard key={issue.id} issue={issue} />
        ))}
        {issues.length === 0 ? (
          <AdminEmptyState
            title="No matching issues"
            description="Adjust the current filters to see other monitoring issues."
          />
        ) : null}
      </div>
    </>
  );
}
