"use client";

import { useState, useTransition } from "react";
import { revealMonitoringEventIdentity, retryMonitoringAlertDelivery } from "@/actions/admin/monitoring";
import { MonitoringOriginalError, monitoringErrorCopy } from "@/components/admin/monitoring-readable-error";
import { monitoringIdentity } from "@/lib/monitoring/identity";
import { vercelLogsUrl } from "@/lib/monitoring/request-context";

interface EventRecord {
  id: string;
  severity: string;
  source: string;
  occurredAt: string;
  requestPath: string | null;
  message: string;
  route: string | null;
  action: string | null;
  component: string | null;
  requestId: string | null;
  userEmail: string | null;
  userId: string | null;
  ipHash: string | null;
  environment: string;
  stack: string | null;
  tags: unknown;
  extra: unknown;
}

function jsonPreview(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const text = JSON.stringify(value, null, 2);
  return text === "{}" ? null : text.slice(0, 4000);
}

export function MonitoringEventContext({
  event,
  logsBaseUrl,
}: {
  event: EventRecord;
  logsBaseUrl?: string;
}) {
  const [revealed, setRevealed] = useState(false);
  const [identity, setIdentity] = useState({
    userEmail: event.userEmail,
    userId: event.userId,
    ipHash: event.ipHash,
  });
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const tags = jsonPreview(event.tags);
  const extra = jsonPreview(event.extra);
  const plain = monitoringErrorCopy({
    title: event.message,
    message: event.message,
    route: event.route ?? event.requestPath,
    action: event.action,
    environment: event.environment,
    severity: event.severity,
    omitCount: true,
  });

  function reveal() {
    setError(null);
    startTransition(async () => {
      const result = await revealMonitoringEventIdentity(event.id);
      if (result.error || !result.data) {
        setError(typeof result.error === "string" ? result.error : "Could not reveal identity");
        return;
      }
      setIdentity(result.data);
      setRevealed(true);
    });
  }

  return (
    <div className="rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-center gap-2 text-xs text-text-secondary">
        <span>{event.severity}</span>
        <span>{event.source}</span>
        <span>{new Date(event.occurredAt).toLocaleString("en-GB")}</span>
        {event.requestPath ? <span className="font-mono">{event.requestPath}</span> : null}
      </div>
      <p className="mt-2 text-sm leading-6 text-text-primary">{plain.summary}</p>
      <div className="mt-3">
        <MonitoringOriginalError title={event.message} message={event.message} extra={event.stack} />
      </div>
      <div className="mt-2 grid gap-2 text-xs text-text-secondary sm:grid-cols-2">
        <p>Route: {event.route ?? "-"}</p>
        <p>Action: {event.action ?? "-"}</p>
        <p>Component: {event.component ?? "-"}</p>
        <p>Request ID: {event.requestId ?? "-"}</p>
        <p>User: {monitoringIdentity(identity.userEmail ?? identity.userId, revealed)}</p>
        <p>Network: {monitoringIdentity(identity.ipHash, revealed)}</p>
        <p>Environment: {event.environment}</p>
      </div>
      <div className="mt-3 flex flex-wrap gap-3 text-xs">
        <button type="button" className="font-medium text-text-trust" onClick={reveal} disabled={isPending || revealed}>
          {revealed ? "Identity revealed" : "Reveal identity"}
        </button>
        {event.requestId ? (
          <a className="font-medium text-text-trust" href={vercelLogsUrl(event.requestId, logsBaseUrl)}>
            Open matching Vercel logs
          </a>
        ) : null}
      </div>
      {error ? <p role="alert" className="mt-2 text-xs text-text-error">{error}</p> : null}
      {tags ? <pre className="mt-3 overflow-x-auto rounded-md border border-border bg-canvas p-3 text-[11px]">{tags}</pre> : null}
      {extra ? <pre className="mt-3 overflow-x-auto rounded-md border border-border bg-canvas p-3 text-[11px]">{extra}</pre> : null}
    </div>
  );
}

export function RetryAlertButton({ deliveryId }: { deliveryId: string }) {
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <div>
      <button
        type="button"
        className="text-xs font-medium text-text-trust"
        disabled={isPending}
        onClick={() => {
          startTransition(async () => {
            const result = await retryMonitoringAlertDelivery(deliveryId);
            setMessage(result.error
              ? (typeof result.error === "string" ? result.error : "Retry failed")
              : "Retry queued");
          });
        }}
      >
        Retry
      </button>
      {message ? <p className="text-xs text-text-secondary">{message}</p> : null}
    </div>
  );
}
