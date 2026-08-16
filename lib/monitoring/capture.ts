import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { createMonitoringFingerprint } from "./fingerprint";
import {
  redactFreeText,
  redactMonitoringPayload,
  redactStack,
  sanitizeRequestPath,
} from "./redact";
import { coerceSeverity, maxSeverity } from "./severity";
import { dispatchMonitoringAlerts } from "./alerts";
import type {
  CapturedMonitoringEvent,
  CaptureBusinessEventInput,
  CaptureExceptionInput,
  MonitoringContext,
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

function sanitizeOptional(value: string | undefined): string | undefined {
  return value === undefined ? undefined : redactFreeText(value);
}

export function sanitizeMonitoringContext(input: MonitoringContext): MonitoringContext {
  return {
    title: sanitizeOptional(input.title),
    environment: sanitizeOptional(input.environment),
    route: sanitizeRequestPath(input.route),
    action: sanitizeOptional(input.action),
    component: sanitizeOptional(input.component),
    requestMethod: sanitizeOptional(input.requestMethod),
    requestPath: sanitizeRequestPath(input.requestPath),
    requestId: sanitizeOptional(input.requestId),
    userId: sanitizeOptional(input.userId),
    userEmail: sanitizeOptional(input.userEmail),
    ipHash: sanitizeOptional(input.ipHash),
    tags: redactMonitoringPayload(input.tags),
    extra: redactMonitoringPayload(input.extra),
  };
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

  const issue = await db.monitoringIssue.upsert({
    where: { fingerprint },
    create: {
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
    update: {
      lastSeenAt: now,
      occurrences: { increment: 1 },
      sampleMessage: prepared.message,
      sampleRoute: prepared.route ?? null,
      sampleAction: prepared.action ?? null,
      sampleComponent: prepared.component ?? null,
    },
    select: { id: true, severity: true, status: true, occurrences: true },
  });

  const isNew = issue.occurrences === 1;
  const desiredSeverity = maxSeverity(issue.severity, prepared.severity);
  const shouldReopen = !isNew && issue.status === "RESOLVED";

  if (desiredSeverity !== issue.severity || shouldReopen) {
    await db.monitoringIssue.update({
      where: { id: issue.id },
      data: {
        ...(desiredSeverity !== issue.severity
          ? { severity: desiredSeverity }
          : {}),
        ...(shouldReopen ? { status: "OPEN", resolvedAt: null } : {}),
      },
    });
  }

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
    createdIssue: isNew,
  };
}

export async function captureException(
  input: CaptureExceptionInput
): Promise<CapturedMonitoringEvent | null> {
  try {
    const payload = extractErrorPayload(input.error);
    const source = input.source;
    const severity = coerceSeverity(input.severity, source);
    const context = sanitizeMonitoringContext(input);

    const message = redactFreeText(payload.message);
    return persistCapture({
      source,
      severity,
      title: context.title ?? message.slice(0, 180),
      message,
      stack: payload.stack,
      environment: context.environment ?? process.env.NODE_ENV ?? "unknown",
      route: context.route,
      action: context.action,
      component: context.component,
      requestMethod: context.requestMethod,
      requestPath: context.requestPath,
      requestId: context.requestId,
      userId: context.userId,
      userEmail: context.userEmail,
      ipHash: context.ipHash,
      tags: context.tags,
      extra: context.extra,
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
    const context = sanitizeMonitoringContext(input);

    const message = redactFreeText(input.message);
    return persistCapture({
      source,
      severity,
      title: context.title ?? message.slice(0, 180),
      message,
      stack: null,
      environment: context.environment ?? process.env.NODE_ENV ?? "unknown",
      route: context.route,
      action: context.action,
      component: context.component,
      requestMethod: context.requestMethod,
      requestPath: context.requestPath,
      requestId: context.requestId,
      userId: context.userId,
      userEmail: context.userEmail,
      ipHash: context.ipHash,
      tags: context.tags,
      extra: context.extra,
    });
  } catch {
    return null;
  }
}
