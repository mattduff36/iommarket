export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Activity } from "lucide-react";
import { AdminEmptyState } from "@/components/admin/admin-empty-state";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import {
  AdminTable,
  AdminTableEmpty,
  adminDateCellClass,
  adminNumericCellClass,
} from "@/components/admin/admin-table";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { db } from "@/lib/db";
import { IssueStatusControls } from "./issue-status-controls";
import { CursorPromptControls } from "./cursor-prompt-controls";
import { MonitoringEventContext, RetryAlertButton } from "./event-context";
import { maskMonitoringIdentity } from "@/lib/monitoring/identity";
import { MonitoringOriginalError, monitoringErrorCopy } from "@/components/admin/monitoring-readable-error";

interface Props {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  return { title: `Monitoring Issue ${id}` };
}

function statusVariant(status: string): "neutral" | "warning" | "error" | "success" | "info" {
  if (status === "OPEN") return "warning";
  if (status === "MUTED") return "neutral";
  if (status === "ACKNOWLEDGED") return "info";
  return "success";
}

function severityVariant(severity: string): "neutral" | "warning" | "error" | "success" | "info" {
  if (severity === "CRITICAL") return "error";
  if (severity === "HIGH") return "warning";
  if (severity === "MEDIUM") return "info";
  return "neutral";
}

export default async function MonitoringIssuePage({ params }: Props) {
  const { id } = await params;

  const issue = await db.monitoringIssue.findUnique({
    where: { id },
    include: {
      events: {
        orderBy: { occurredAt: "desc" },
        take: 50,
      },
      alertDeliveries: {
        orderBy: { createdAt: "desc" },
        take: 30,
      },
      statusEvents: {
        orderBy: { createdAt: "desc" },
        take: 30,
      },
    },
  });
  const assignee = issue?.assigneeAdminId
    ? await db.user.findUnique({
        where: { id: issue.assigneeAdminId },
        select: { email: true },
      })
    : null;

  if (!issue) notFound();
  const plain = monitoringErrorCopy({
    title: issue.title,
    message: issue.sampleMessage,
    route: issue.sampleRoute,
    action: issue.sampleAction,
    environment: issue.events[0]?.environment,
    occurrences: issue.occurrences,
    severity: issue.severity,
  });

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title={plain.subject}
        description={plain.summary}
        meta={
          <>
            <Badge variant={statusVariant(issue.status)}>{issue.status}</Badge>
            <Badge variant={severityVariant(issue.severity)}>{issue.severity}</Badge>
            <Badge variant="neutral">{issue.source}</Badge>
            <span className="break-all font-mono">{issue.id}</span>
          </>
        }
        actions={
          <Link
            href="/admin/monitoring"
            className="text-sm font-medium text-text-secondary hover:text-text-primary"
          >
            &larr; All issues
          </Link>
        }
      />

      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>Issue Context</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p>
              <span className="text-text-secondary">Occurrences:</span>{" "}
              <span className="font-medium text-text-primary">{issue.occurrences}</span>
            </p>
            <p>
              <span className="text-text-secondary">Last seen:</span>{" "}
              <span className="font-medium text-text-primary">
                {issue.lastSeenAt.toLocaleString("en-GB")}
              </span>
            </p>
            <p>
              <span className="text-text-secondary">Sample route:</span>{" "}
              <span className="font-mono text-text-primary">{issue.sampleRoute ?? "-"}</span>
            </p>
            <p>
              <span className="text-text-secondary">Sample action:</span>{" "}
              <span className="font-mono text-text-primary">{issue.sampleAction ?? "-"}</span>
            </p>
            <p>
              <span className="text-text-secondary">Sample component:</span>{" "}
              <span className="font-mono text-text-primary">{issue.sampleComponent ?? "-"}</span>
            </p>
            <p>
              <span className="text-text-secondary">First seen:</span>{" "}
              <span className="font-medium text-text-primary">
                {issue.firstSeenAt.toLocaleString("en-GB")}
              </span>
            </p>
            <MonitoringOriginalError title={issue.title} message={issue.sampleMessage} />
            {issue.mutedUntil && (
              <p className="text-xs text-text-secondary">
                Muted until {issue.mutedUntil.toLocaleString("en-GB")}
              </p>
            )}
            {issue.resolvedAt && (
              <p className="text-xs text-emerald-500">
                Resolved at {issue.resolvedAt.toLocaleString("en-GB")}
              </p>
            )}
            <p>
              <span className="text-text-secondary">Assignee:</span>{" "}
              <span className="font-medium text-text-primary">
                {maskMonitoringIdentity(assignee?.email ?? issue.assigneeAdminId)}
              </span>
            </p>
            <p>
              <span className="text-text-secondary">Suppressed alerts:</span>{" "}
              <span className="font-medium text-text-primary">{issue.suppressedAlertCount}</span>
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Triage Actions</CardTitle>
          </CardHeader>
          <CardContent>
            <IssueStatusControls issueId={issue.id} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Cursor Prompt</CardTitle>
        </CardHeader>
        <CardContent>
          <CursorPromptControls
            issueId={issue.id}
            initialPrompt={issue.lastGeneratedPrompt}
            generatedAt={
              issue.lastPromptGeneratedAt
                ? issue.lastPromptGeneratedAt.toISOString()
                : null
            }
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent Events</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {issue.events.map((event) => (
            <MonitoringEventContext
              key={event.id}
              logsBaseUrl={process.env.MONITORING_VERCEL_LOGS_BASE_URL}
              event={{
                ...event,
                occurredAt: event.occurredAt.toISOString(),
              }}
            />
          ))}
          {issue.events.length === 0 && (
            <AdminEmptyState
              icon={Activity}
              title="No events recorded yet"
              description="New occurrences for this issue will appear here."
              compact
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Alert Deliveries</CardTitle>
        </CardHeader>
        <CardContent>
          <AdminTable minWidth="wide">
            <TableHeader>
              <TableRow>
                <TableHead>Channel</TableHead>
                <TableHead>Target</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Attempts</TableHead>
                <TableHead>Error</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {issue.alertDeliveries.map((delivery) => (
                <TableRow key={delivery.id}>
                  <TableCell>{delivery.channel}</TableCell>
                  <TableCell className="font-mono text-xs">{delivery.target}</TableCell>
                  <TableCell>{delivery.status}</TableCell>
                  <TableCell className={adminNumericCellClass}>
                    {delivery.attempts}
                  </TableCell>
                  <TableCell className="max-w-xs truncate text-xs">{delivery.lastError ?? "-"}</TableCell>
                  <TableCell className={adminDateCellClass}>
                    {delivery.createdAt.toLocaleString("en-GB")}
                  </TableCell>
                  <TableCell>
                    {delivery.status === "FAILED" ? <RetryAlertButton deliveryId={delivery.id} /> : null}
                  </TableCell>
                </TableRow>
              ))}
              {issue.alertDeliveries.length === 0 && (
                <TableRow>
                  <AdminTableEmpty colSpan={7}>
                    No alerts have been sent for this issue yet.
                  </AdminTableEmpty>
                </TableRow>
              )}
            </TableBody>
          </AdminTable>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Status history</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {issue.statusEvents.map((statusEvent) => (
            <div key={statusEvent.id} className="rounded-md border border-border px-3 py-2 text-sm">
              <p className="font-medium text-text-primary">
                {statusEvent.fromStatus ?? "NEW"} → {statusEvent.toStatus}
              </p>
              <p className="text-xs text-text-secondary">
                {statusEvent.createdAt.toLocaleString("en-GB")}
                {statusEvent.notes ? ` · ${statusEvent.notes}` : ""}
              </p>
            </div>
          ))}
          {issue.statusEvents.length === 0 ? (
            <AdminEmptyState compact title="No status changes" description="Triage notes will appear here." />
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
