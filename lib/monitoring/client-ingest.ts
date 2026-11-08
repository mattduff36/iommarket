import { safeSupportReference } from "@/lib/forms/public-error";
import { browserDiagnostics } from "./client-diagnostics";
import { requestDiagnostics, safeRequestDiagnostic } from "./request-diagnostics";
import { safeResourceDiagnostic } from "./resource-diagnostics";
import { isConsoleCaptureEnabled } from "./flags";
import { isMonitoringIngestPath, redactFreeText, redactStack } from "./redact";

export const MAX_CLIENT_EVENTS_PER_PAGE = 20;
export const CLIENT_DEDUP_WINDOW_MS = 5_000;

export interface ClientEventPayload {
  message: string;
  stack?: string;
  severity?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  route?: string;
  component?: string;
  tags?: Record<string, unknown>;
  extra?: Record<string, unknown>;
}

export interface ClientEventLimiter {
  canSend(key: string, now?: number): boolean;
}

export function createClientEventLimiter(
  maxEvents = MAX_CLIENT_EVENTS_PER_PAGE,
  dedupWindowMs = CLIENT_DEDUP_WINDOW_MS,
): ClientEventLimiter {
  let sentCount = 0;
  const recent = new Map<string, number>();

  return {
    canSend(key: string, now = Date.now()) {
      if (sentCount >= maxEvents) return false;
      const lastSent = recent.get(key);
      if (lastSent !== undefined && now - lastSent < dedupWindowMs) {
        return false;
      }
      recent.set(key, now);
      sentCount += 1;
      return true;
    },
  };
}

export function createClientEventKey(payload: ClientEventPayload): string {
  return [
    payload.component ?? "",
    payload.message.slice(0, 200),
    (payload.stack ?? "").slice(0, 200),
  ].join("|");
}

export async function sendClientMonitoringEvent(
  payload: ClientEventPayload,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  const route = payload.route ?? (typeof window !== "undefined" ? window.location.pathname : undefined);
  if (isMonitoringIngestPath(route)) return null;

  try {
    const response = await fetchImpl("/api/monitoring/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...payload,
        tags: { ...payload.tags, clientRelease: process.env.NEXT_PUBLIC_MONITORING_RELEASE || undefined },
        extra: { ...payload.extra, diagnostics: browserDiagnostics(), requests: requestDiagnostics(),
          triggeringRequest: safeRequestDiagnostic(payload.extra?.triggeringRequest),
          resource: safeResourceDiagnostic(payload.extra?.resource) },
        message: redactFreeText(payload.message).slice(0, 2000),
        stack: redactStack(payload.stack) ?? undefined,
        route,
      }),
      keepalive: true,
    });
    if (!response.ok || typeof response.json !== "function") return null;
    const body = await response.json() as { eventId?: unknown };
    return safeSupportReference(body?.eventId) ?? null;
  } catch {
    return null;
  }
}

const boundaryLimiter = createClientEventLimiter();

export function reportClientBoundaryError(input: {
  error: Error & { digest?: string };
  component: string;
  limiter?: ClientEventLimiter;
  fetchImpl?: typeof fetch;
}): Promise<string | null> {
  const payload: ClientEventPayload = {
    message: input.error.message || "React render error",
    stack: input.error.stack,
    severity: "HIGH",
    component: input.component,
    tags: {
      type: "react-error-boundary",
      digest: input.error.digest ?? null,
    },
  };
  const limiter = input.limiter ?? boundaryLimiter;
  if (limiter && !limiter.canSend(createClientEventKey(payload))) {
    return Promise.resolve(null);
  }
  return sendClientMonitoringEvent(payload, input.fetchImpl);
}

export function shouldCaptureConsoleErrors(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return isConsoleCaptureEnabled(env);
}
