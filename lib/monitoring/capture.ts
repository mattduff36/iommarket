import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { createMonitoringFingerprint } from "./fingerprint";
import { redactMonitoringPayload, redactStack } from "./redact";
import { coerceSeverity, maxSeverity } from "./severity";
import { dispatchMonitoringAlerts } from "./alerts";
import type {
  CapturedMonitoringEvent,
  CaptureBusinessEventInput,
  CaptureExceptionInput,
  MonitoringSeverity,
  MonitoringSource,
} from "./types";

interface PreparedCapture {
  source: MonitoringSource;
  severity: MonitoringSeverity;
  title: string;
  message: string;
  stack: string | null;
  environment: string;
  route?: string;
  action?: string;
  component?: string;
  requestMethod?: string;
  requestPath?: string;
  requestId?: string;
  userId?: string;
  userEmail?: string;
  ipHash?: string;
  tags?: Record<string, unknown>;
  extra?: Record<string, unknown>;
}

function extractErrorPayload(error: unknown): { message: string; stack: string | null } {
  if (error instanceof Error) {
    return {
      message: error.message || error.name || "Unknown error",
      stack: redactStack(error.stack),
    };
  }

  if (typeof error === "string") {
    return { message: error, stack: null };
  }

  return {
    message: "Unknown exception",
    stack: null,
  };
}

function toJson(value: Record<string, unknown> | undefined): Prisma.InputJsonValue | undefined {
  if (!value) return undefined;
  return value as Prisma.InputJsonValue;
}

async function persistCapture(
  prepared: PreparedCapture
): Promise<CapturedMonitoringEvent> {
  const now = new Date();
  const fingerprint = createMonitoringFingerprint({
    source: prepared.source,
    message: prepared.message,
    stack: prepared.stack,
    route: prepared.route,
    action: prepared.action,
    component: prepared.component,
  });

  const existing = await db.monitoringIssue.findUnique({
    where: { fingerprint },
    select: { id: true, severity: true, status: true },
  });

  const issue = existing
    ? await db.monitoringIssue.update({
        where: { id: existing.id },
        data: {
          lastSeenAt: now,
          occurrences: { increment: 1 },
          severity: maxSeverity(existing.severity, prepared.severity),
          sampleMessage: prepared.message,
          sampleRoute: prepared.route ?? null,
          sampleAction: prepared.action ?? null,
          sampleComponent: prepared.component ?? null,
          ...(existing.status === "RESOLVED"
            ? { status: "OPEN", resolvedAt: null }
            : {}),
        },
        select: { id: true },
      })
    : await db.monitoringIssue.create({
        data: {
          fingerprint,
          title: prepared.title,
          status: "OPEN",
          severity: prepared.severity,
          source: prepared.source,
          firstSeenAt: now,
          lastSeenAt: now,
          occurrences: 1,
          sampleMessage: prepared.message,
          sampleRoute: prepared.route ?? null,
          sampleAction: prepared.action ?? null,
          sampleComponent: prepared.component ?? null,
        },
        select: { id: true },
      });

  const event = await db.monitoringEvent.create({
    data: {
      issueId: issue.id,
      source: prepared.source,
      severity: prepared.severity,
      environment: prepared.environment,
      message: prepared.message,
      stack: prepared.stack,
      route: prepared.route,
      action: prepared.action,
      component: prepared.component,
      requestMethod: prepared.requestMethod,
      requestPath: prepared.requestPath,
      requestId: prepared.requestId,
      userId: prepared.userId,
      userEmail: prepared.userEmail,
      ipHash: prepared.ipHash,
      tags: toJson(prepared.tags),
      extra: toJson(prepared.extra),
      occurredAt: now,
    },
    select: { id: true },
  });

  dispatchMonitoringAlerts({
    issueId: issue.id,
    eventId: event.id,
  }).catch(() => {});

  return {
    issueId: issue.id,
    eventId: event.id,
    fingerprint,
    createdIssue: !existing,
  };
}

export async function captureException(
  input: CaptureExceptionInput
): Promise<CapturedMonitoringEvent | null> {
  try {
    const payload = extractErrorPayload(input.error);
    const source = input.source;
    const severity = coerceSeverity(input.severity, source);

    return persistCapture({
      source,
      severity,
      title: input.title ?? payload.message.slice(0, 180),
      message: payload.message,
      stack: payload.stack,
      environment: input.environment ?? process.env.NODE_ENV ?? "unknown",
      route: input.route,
      action: input.action,
      component: input.component,
      requestMethod: input.requestMethod,
      requestPath: input.requestPath,
      requestId: input.requestId,
      userId: input.userId,
      userEmail: input.userEmail,
      ipHash: input.ipHash,
      tags: redactMonitoringPayload(input.tags),
      extra: redactMonitoringPayload(input.extra),
    });
  } catch {
    return null;
  }
}

export async function captureBusinessEvent(
  input: CaptureBusinessEventInput
): Promise<CapturedMonitoringEvent | null> {
  try {
    const source = input.source ?? "BUSINESS";
    const severity = coerceSeverity(input.severity, source);

    return persistCapture({
      source,
      severity,
      title: input.title ?? input.message.slice(0, 180),
      message: input.message,
      stack: null,
      environment: input.environment ?? process.env.NODE_ENV ?? "unknown",
      route: input.route,
      action: input.action,
      component: input.component,
      requestMethod: input.requestMethod,
      requestPath: input.requestPath,
      requestId: input.requestId,
      userId: input.userId,
      userEmail: input.userEmail,
      ipHash: input.ipHash,
      tags: redactMonitoringPayload(input.tags),
      extra: redactMonitoringPayload(input.extra),
    });
  } catch {
    return null;
  }
}
