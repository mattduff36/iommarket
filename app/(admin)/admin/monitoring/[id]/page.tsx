export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { db } from "@/lib/db";
import { IssueStatusControls } from "./issue-status-controls";
import { CursorPromptControls } from "./cursor-prompt-controls";

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
    },
  });

  if (!issue) notFound();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wider text-text-tertiary">
            Monitoring Issue
          </p>
          <h1 className="text-2xl font-bold text-text-primary">{issue.title}</h1>
          <p className="text-xs text-text-secondary mt-1">
            <span className="font-mono">{issue.id}</span>
            {" · "}
            first seen {issue.firstSeenAt.toLocaleString("en-GB")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={statusVariant(issue.status)}>{issue.status}</Badge>
          <Badge variant={severityVariant(issue.severity)}>{issue.severity}</Badge>
          <Badge variant="neutral">{issue.source}</Badge>
        </div>
      </div>

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
              <span className="font-mono text-text-primary">{issue.sampleRoute ?? "—"}</span>
            </p>
            <p>
              <span className="text-text-secondary">Sample action:</span>{" "}
              <span className="font-mono text-text-primary">{issue.sampleAction ?? "—"}</span>
            </p>
            <p>
              <span className="text-text-secondary">Sample component:</span>{" "}
              <span className="font-mono text-text-primary">{issue.sampleComponent ?? "—"}</span>
            </p>
            <div>
              <p className="text-text-secondary mb-1">Message:</p>
              <p className="rounded-md border border-border bg-canvas px-3 py-2 text-text-primary">
                {issue.sampleMessage}
              </p>
            </div>
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
            <div key={event.id} className="rounded-lg border border-border p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={severityVariant(event.severity)}>{event.severity}</Badge>
                <Badge variant="neutral">{event.source}</Badge>
                <span className="text-xs text-text-secondary">
                  {event.occurredAt.toLocaleString("en-GB")}
                </span>
                {event.requestPath && (
                  <span className="text-xs font-mono text-text-secondary">
                    {event.requestPath}
                  </span>
                )}
              </div>
              <p className="mt-2 text-sm text-text-primary">{event.message}</p>
              <div className="mt-2 grid gap-2 text-xs text-text-secondary sm:grid-cols-2">
                <p>Route: {event.route ?? "—"}</p>
                <p>Action: {event.action ?? "—"}</p>
                <p>Component: {event.component ?? "—"}</p>
                <p>Request ID: {event.requestId ?? "—"}</p>
                <p>User: {event.userEmail ?? event.userId ?? "anonymous"}</p>
                <p>Environment: {event.environment}</p>
              </div>
              {event.stack ? (
                <pre className="mt-3 overflow-x-auto rounded-md border border-border bg-canvas p-3 text-[11px] text-text-secondary">
                  {event.stack}
                </pre>
              ) : null}
            </div>
          ))}
          {issue.events.length === 0 && (
            <p className="text-sm text-text-secondary">No events recorded yet.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Alert Deliveries</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Channel</TableHead>
                <TableHead>Target</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Attempts</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {issue.alertDeliveries.map((delivery) => (
                <TableRow key={delivery.id}>
                  <TableCell>{delivery.channel}</TableCell>
                  <TableCell className="font-mono text-xs">{delivery.target}</TableCell>
                  <TableCell>{delivery.status}</TableCell>
                  <TableCell>{delivery.attempts}</TableCell>
                  <TableCell>{delivery.createdAt.toLocaleString("en-GB")}</TableCell>
                </TableRow>
              ))}
              {issue.alertDeliveries.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-sm text-text-secondary">
                    No alerts sent for this issue yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div>
        <Link href="/admin/monitoring" className="text-sm text-text-trust hover:underline">
          Back to monitoring list
        </Link>
      </div>
    </div>
  );
}
