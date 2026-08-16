export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
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
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">Monitoring</h1>
        <p className="text-sm text-text-secondary mt-1">
          Centralized error and anomaly triage for production and staging issues.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-border bg-surface p-4">
          <p className="text-xs uppercase tracking-wider text-text-tertiary">Open Issues</p>
          <p className="mt-2 text-2xl font-bold text-text-primary">{openCount}</p>
        </div>
        <div className="rounded-lg border border-border bg-surface p-4">
          <p className="text-xs uppercase tracking-wider text-text-tertiary">Critical Active</p>
          <p className="mt-2 text-2xl font-bold text-text-energy">{criticalOpenCount}</p>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-surface p-4">
        <p className="text-xs uppercase tracking-wider text-text-tertiary mb-2">Filters</p>
        <div className="flex flex-wrap gap-2">
          <Link
            href={buildFilterHref({ q })}
            className="rounded-md border border-border px-2 py-1 text-xs text-text-secondary hover:text-text-primary"
          >
            All
          </Link>
          {STATUS_OPTIONS.map((option) => (
            <Link
              key={option}
              href={buildFilterHref({ status: option, severity, source, q })}
              className={`rounded-md border px-2 py-1 text-xs ${
                status === option
                  ? "border-neon-blue-500 text-neon-blue-400"
                  : "border-border text-text-secondary hover:text-text-primary"
              }`}
            >
              {option}
            </Link>
          ))}
        </div>
        <div className="flex flex-wrap gap-2 mt-2">
          {SEVERITY_OPTIONS.map((option) => (
            <Link
              key={option}
              href={buildFilterHref({ status, severity: option, source, q })}
              className={`rounded-md border px-2 py-1 text-xs ${
                severity === option
                  ? "border-premium-gold-500 text-premium-gold-400"
                  : "border-border text-text-secondary hover:text-text-primary"
              }`}
            >
              {option}
            </Link>
          ))}
          {SOURCE_OPTIONS.map((option) => (
            <Link
              key={option}
              href={buildFilterHref({ status, severity, source: option, q })}
              className={`rounded-md border px-2 py-1 text-xs ${
                source === option
                  ? "border-emerald-500 text-emerald-400"
                  : "border-border text-text-secondary hover:text-text-primary"
              }`}
            >
              {option}
            </Link>
          ))}
        </div>
      </div>

      <div className="space-y-3">
        {issues.map((issue) => (
          <MonitoringIssueCard key={issue.id} issue={issue} />
        ))}
        {issues.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-surface px-6 py-12 text-center">
            <p className="text-sm font-medium text-text-primary">No matching issues</p>
            <p className="mt-1 text-sm text-text-secondary">
              Adjust the current filters to see other monitoring issues.
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
