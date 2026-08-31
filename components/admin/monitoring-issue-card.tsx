import Link from "next/link";
import { ArrowRight, ChevronDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface StatusEventSummary {
  toStatus: string;
  notes: string | null;
  createdAt: Date;
}

export interface MonitoringIssueCardData {
  id: string;
  fingerprint: string;
  title: string;
  status: string;
  severity: string;
  source: string;
  firstSeenAt: Date;
  lastSeenAt: Date;
  occurrences: number;
  sampleMessage: string;
  sampleRoute: string | null;
  sampleAction: string | null;
  sampleComponent: string | null;
  mutedUntil: Date | null;
  resolvedAt: Date | null;
  lastAlertedAt: Date | null;
  lastPromptGeneratedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  _count: { events: number };
  statusEvents: StatusEventSummary[];
}

function statusVariant(status: string): "neutral" | "warning" | "success" | "info" {
  if (status === "OPEN") return "warning";
  if (status === "MUTED") return "neutral";
  if (status === "ACKNOWLEDGED") return "info";
  return "success";
}

function severityVariant(
  severity: string,
): "neutral" | "warning" | "error" | "info" {
  if (severity === "CRITICAL") return "error";
  if (severity === "HIGH") return "warning";
  if (severity === "MEDIUM") return "info";
  return "neutral";
}

function Timestamp({ value }: { value: Date | null }) {
  if (!value) return <span>-</span>;
  return (
    <time dateTime={value.toISOString()} className="tabular-nums">
      {value.toLocaleString("en-GB")}
    </time>
  );
}

function ContextValue({ value }: { value: string | null }) {
  return (
    <span className="break-words font-mono text-xs text-text-primary">
      {value ?? "-"}
    </span>
  );
}

export function MonitoringIssueCard({ issue }: { issue: MonitoringIssueCardData }) {
  const latestStatusEvent = issue.statusEvents[0];

  return (
    <details className="group rounded-lg border border-border bg-surface shadow-low transition-colors open:border-neon-blue-500/40">
      <summary className="flex min-h-24 cursor-pointer list-none items-start gap-4 rounded-lg p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-neon-blue-500 sm:p-5 [&::-webkit-details-marker]:hidden">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={statusVariant(issue.status)}>{issue.status}</Badge>
            <Badge variant={severityVariant(issue.severity)}>{issue.severity}</Badge>
            <Badge variant="neutral">{issue.source}</Badge>
          </div>
          <h2 className="mt-3 text-base font-semibold leading-snug text-text-primary">
            {issue.title}
          </h2>
          <p className="mt-1 line-clamp-2 text-sm leading-6 text-text-secondary">
            {issue.sampleMessage}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-tertiary">
            <span>
              {issue._count.events} event{issue._count.events === 1 ? "" : "s"}
            </span>
            <span>
              {issue.occurrences} occurrence{issue.occurrences === 1 ? "" : "s"}
            </span>
            <span>
              Last seen <Timestamp value={issue.lastSeenAt} />
            </span>
          </div>
        </div>
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-text-secondary transition-colors group-hover:bg-surface-elevated group-hover:text-text-primary">
          <ChevronDown
            aria-hidden="true"
            className="h-5 w-5 transition-transform duration-200 group-open:rotate-180"
          />
        </span>
      </summary>

      <div className="border-t border-border px-4 py-5 sm:px-5">
        <section aria-labelledby={`message-${issue.id}`}>
          <h3
            id={`message-${issue.id}`}
            className="text-xs font-semibold uppercase tracking-wider text-text-tertiary"
          >
            Error summary
          </h3>
          <p className="mt-2 max-w-4xl whitespace-pre-wrap break-words rounded-md bg-canvas px-4 py-3 text-sm leading-6 text-text-primary">
            {issue.sampleMessage}
          </p>
        </section>

        <div className="mt-6 grid gap-6 xl:grid-cols-2">
          <section aria-labelledby={`context-${issue.id}`}>
            <h3
              id={`context-${issue.id}`}
              className="text-sm font-semibold text-text-primary"
            >
              Context
            </h3>
            <dl className="mt-3 grid gap-x-6 gap-y-4 sm:grid-cols-2">
              <div>
                <dt className="text-xs text-text-tertiary">Route</dt>
                <dd className="mt-1"><ContextValue value={issue.sampleRoute} /></dd>
              </div>
              <div>
                <dt className="text-xs text-text-tertiary">Action</dt>
                <dd className="mt-1"><ContextValue value={issue.sampleAction} /></dd>
              </div>
              <div>
                <dt className="text-xs text-text-tertiary">Component</dt>
                <dd className="mt-1"><ContextValue value={issue.sampleComponent} /></dd>
              </div>
              <div>
                <dt className="text-xs text-text-tertiary">Issue ID</dt>
                <dd className="mt-1"><ContextValue value={issue.id} /></dd>
              </div>
            </dl>
          </section>

          <section aria-labelledby={`timeline-${issue.id}`}>
            <h3
              id={`timeline-${issue.id}`}
              className="text-sm font-semibold text-text-primary"
            >
              Timeline
            </h3>
            <dl className="mt-3 grid gap-x-6 gap-y-4 sm:grid-cols-2">
              <div>
                <dt className="text-xs text-text-tertiary">First seen</dt>
                <dd className="mt-1 text-sm text-text-primary">
                  <Timestamp value={issue.firstSeenAt} />
                </dd>
              </div>
              <div>
                <dt className="text-xs text-text-tertiary">Last seen</dt>
                <dd className="mt-1 text-sm text-text-primary">
                  <Timestamp value={issue.lastSeenAt} />
                </dd>
              </div>
              <div>
                <dt className="text-xs text-text-tertiary">Resolved</dt>
                <dd className="mt-1 text-sm text-text-primary">
                  <Timestamp value={issue.resolvedAt} />
                </dd>
              </div>
              <div>
                <dt className="text-xs text-text-tertiary">Updated</dt>
                <dd className="mt-1 text-sm text-text-primary">
                  <Timestamp value={issue.updatedAt} />
                </dd>
              </div>
              <div>
                <dt className="text-xs text-text-tertiary">Record created</dt>
                <dd className="mt-1 text-sm text-text-primary">
                  <Timestamp value={issue.createdAt} />
                </dd>
              </div>
              {issue.mutedUntil ? (
                <div>
                  <dt className="text-xs text-text-tertiary">Muted until</dt>
                  <dd className="mt-1 text-sm text-text-primary">
                    <Timestamp value={issue.mutedUntil} />
                  </dd>
                </div>
              ) : null}
              {issue.lastAlertedAt ? (
                <div>
                  <dt className="text-xs text-text-tertiary">Last alerted</dt>
                  <dd className="mt-1 text-sm text-text-primary">
                    <Timestamp value={issue.lastAlertedAt} />
                  </dd>
                </div>
              ) : null}
              {issue.lastPromptGeneratedAt ? (
                <div>
                  <dt className="text-xs text-text-tertiary">Prompt generated</dt>
                  <dd className="mt-1 text-sm text-text-primary">
                    <Timestamp value={issue.lastPromptGeneratedAt} />
                  </dd>
                </div>
              ) : null}
            </dl>
          </section>
        </div>

        {latestStatusEvent ? (
          <section
            aria-labelledby={`status-note-${issue.id}`}
            className="mt-6 border-t border-border pt-5"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3
                id={`status-note-${issue.id}`}
                className="text-sm font-semibold text-text-primary"
              >
                Latest status change
              </h3>
              <span className="text-xs text-text-tertiary">
                {latestStatusEvent.toStatus} ·{" "}
                <Timestamp value={latestStatusEvent.createdAt} />
              </span>
            </div>
            <p className="mt-2 max-w-4xl text-sm leading-6 text-text-secondary">
              {latestStatusEvent.notes ?? "No note was recorded."}
            </p>
          </section>
        ) : null}

        <div className="mt-6 flex flex-wrap items-end justify-between gap-4 border-t border-border pt-5">
          <p className="max-w-full break-all font-mono text-[11px] text-text-tertiary">
            Fingerprint: {issue.fingerprint}
          </p>
          <Link
            href={`/admin/monitoring/${issue.id}`}
            className="inline-flex min-h-10 items-center gap-2 rounded-md px-3 text-sm font-semibold text-text-trust transition-colors hover:bg-neon-blue-500/10 hover:text-neon-blue-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neon-blue-500"
          >
            Review full issue
            <ArrowRight aria-hidden="true" className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </details>
  );
}
