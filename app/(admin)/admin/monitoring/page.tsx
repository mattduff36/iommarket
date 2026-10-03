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
import { MonitoringHealthSummary } from "@/components/admin/monitoring-health-summary";
import { MonitoringQueue } from "@/components/admin/monitoring-queue";
import { decodeMonitoringCursor, encodeMonitoringCursor } from "@/lib/monitoring/pagination";

export const metadata: Metadata = { title: "Monitoring | Admin" };

const STATUS_OPTIONS = ["OPEN", "ACKNOWLEDGED", "MUTED", "RESOLVED"] as const;
const SEVERITY_OPTIONS = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
const SOURCE_OPTIONS = ["SERVER", "CLIENT", "WEBHOOK", "BUSINESS"] as const;

function buildFilterHref(params: {
  status?: string;
  severity?: string;
  source?: string;
  q?: string;
  cursor?: string;
}) {
  const sp = new URLSearchParams();
  if (params.status) sp.set("status", params.status);
  if (params.severity) sp.set("severity", params.severity);
  if (params.source) sp.set("source", params.source);
  if (params.q) sp.set("q", params.q);
  if (params.cursor) sp.set("cursor", params.cursor);
  const query = sp.toString();
  return query ? `/admin/monitoring?${query}` : "/admin/monitoring";
}

interface Props {
  searchParams?: Promise<{
    status?: string;
    severity?: string;
    source?: string;
    q?: string;
    cursor?: string;
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
  const cursor = decodeMonitoringCursor(params.cursor);
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const previousDay = new Date(dayAgo.getTime() - 24 * 60 * 60 * 1000);

  const constraints: Prisma.MonitoringIssueWhereInput[] = [
    ...(cursor
      ? [{
          OR: [
            { lastSeenAt: { lt: cursor.lastSeenAt } },
            { lastSeenAt: cursor.lastSeenAt, id: { lt: cursor.id } },
          ],
        }]
      : []),
    ...(q
      ? [{
          OR: [
            { title: { contains: q, mode: "insensitive" as const } },
            { sampleMessage: { contains: q, mode: "insensitive" as const } },
            { sampleRoute: { contains: q, mode: "insensitive" as const } },
            { sampleAction: { contains: q, mode: "insensitive" as const } },
          ],
        }]
      : []),
  ];
  const where: Prisma.MonitoringIssueWhereInput = {
    ...(status ? { status } : {}),
    ...(severity ? { severity } : {}),
    ...(source ? { source } : {}),
    ...(constraints.length > 0 ? { AND: constraints } : {}),
  };

  const [pageIssues, openCount, criticalOpenCount, recentEvents, previousEvents, recurringCount, failedDeliveries, unresolvedFailedAlerts, failedAlertBatch, health] = await Promise.all([
    db.monitoringIssue.findMany({
      where,
      orderBy: [{ lastSeenAt: "desc" }, { id: "desc" }],
      take: 21,
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
    db.monitoringEvent.count({ where: { occurredAt: { gte: dayAgo } } }),
    db.monitoringEvent.count({ where: { occurredAt: { gte: previousDay, lt: dayAgo } } }),
    db.monitoringIssue.count({
      where: {
        status: { in: ["OPEN", "ACKNOWLEDGED"] },
        occurrences: { gt: 1 },
        lastSeenAt: { gte: dayAgo },
      },
    }),
    db.monitoringAlertDelivery.count({
      where: { status: "FAILED", createdAt: { gte: dayAgo } },
    }),
    db.monitoringAlertDelivery.count({
      where: { status: "FAILED" },
    }),
    db.monitoringAlertDelivery.findMany({
      where: { status: "FAILED" },
      orderBy: { updatedAt: "desc" },
      select: { id: true, lastError: true },
      take: 20,
    }),
    db.monitoringPipelineHealth.findUnique({ where: { id: "singleton" } }),
  ]);
  const hasNextPage = pageIssues.length > 20;
  const issues = hasNextPage ? pageIssues.slice(0, 20) : pageIssues;
  const lastIssue = issues.at(-1);
  const nextCursor = hasNextPage && lastIssue
    ? encodeMonitoringCursor(lastIssue.lastSeenAt, lastIssue.id)
    : null;

  return (
    <>
      <AdminPageHeader
        title="Monitoring"
        description="Centralized error and anomaly triage for production and staging issues."
      />

      <MonitoringHealthSummary
        health={health}
        openCount={openCount}
        criticalCount={criticalOpenCount}
        recentEvents={recentEvents}
        previousEvents={previousEvents}
        recurringCount={recurringCount}
        failedDeliveries={failedDeliveries}
        unresolvedFailedAlerts={unresolvedFailedAlerts}
        failedAlertIds={failedAlertBatch.map((delivery) => delivery.id)}
        latestAlertError={failedAlertBatch[0]?.lastError ?? null}
      />

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

      {issues.length === 0 ? (
        <AdminEmptyState
          title="No matching issues"
          description="Adjust the current filters to see other monitoring issues."
        />
      ) : (
        <MonitoringQueue issues={issues} />
      )}
      {nextCursor ? (
        <div className="mt-4">
          <a
            href={buildFilterHref({ status, severity, source, q, cursor: nextCursor })}
            className="text-sm font-medium text-text-trust hover:text-text-primary"
          >
            Next page
          </a>
        </div>
      ) : null}
    </>
  );
}
