"use client";

import { useEffect, useRef } from "react";
import { diagnosticTarget, installRequestDiagnostics } from "@/lib/monitoring/request-diagnostics";
import { createResourceDiagnostics } from "@/lib/monitoring/resource-diagnostics";
import {
  extractConsoleStack,
  isExpectedClientCancellation,
  serializeConsoleArgs,
  shouldIgnoreClientMonitoringMessage,
  shouldIgnoreConsoleError,
} from "@/lib/monitoring/console-filter";
import {
  createClientEventKey,
  createClientEventLimiter,
  sendClientMonitoringEvent,
  shouldCaptureConsoleErrors,
} from "@/lib/monitoring/client-ingest";

function stringifyReason(reason: unknown): string {
  if (reason instanceof Error) return reason.message;
  if (typeof reason === "string") return reason;
  try {
    return JSON.stringify(reason);
  } catch {
    return "Unhandled rejection";
  }
}

export function ClientErrorListener() {
  const limiterRef = useRef(createClientEventLimiter());

  useEffect(() => {
    const limiter = limiterRef.current;
    const restoreRequests = installRequestDiagnostics(window, window.location.origin, (request) => {
      const payload = {
        message: `Request ${request.outcome}: ${request.method} ${request.target} (${request.status ?? "no response"})`,
        component: "request-diagnostics", severity: "MEDIUM" as const,
        tags: { type: "request-failure" },
        extra: { triggeringRequest: request },
      };
      if (limiter.canSend(createClientEventKey(payload))) void sendClientMonitoringEvent(payload);
    });

    const collectResource = createResourceDiagnostics(window);
    function onLoad(event: Event) { collectResource(event); }

    function onError(event: Event) {
      const resource = collectResource(event);
      const errorEvent = typeof ErrorEvent !== "undefined" && event instanceof ErrorEvent ? event : undefined;
      const message = errorEvent?.error instanceof Error
        ? errorEvent.error.message
        : errorEvent?.message || (resource.target ? `Resource failed to load: ${resource.target}`
          : `Unhandled client error (${resource.elementKind})`);
      const stack = errorEvent?.error instanceof Error ? errorEvent.error.stack : undefined;
      if (shouldIgnoreClientMonitoringMessage(message)) return;
      const payload = {
        message,
        stack,
        severity: "HIGH" as const,
        route: window.location.pathname,
        tags: {
          type: "window.onerror",
          filename: errorEvent?.filename ? diagnosticTarget(errorEvent.filename, window.location.origin) : resource.target,
          line: errorEvent?.lineno,
          col: errorEvent?.colno,
        },
        extra: { resource },
      };
      if (!limiter.canSend(createClientEventKey(payload))) return;
      void sendClientMonitoringEvent(payload);
    }

    function onUnhandledRejection(event: PromiseRejectionEvent) {
      if (isExpectedClientCancellation(event.reason)) return;
      const message = stringifyReason(event.reason);
      const stack = event.reason instanceof Error ? event.reason.stack : undefined;
      if (shouldIgnoreClientMonitoringMessage(message)) return;
      const payload = {
        message,
        stack,
        severity: "MEDIUM" as const,
        route: window.location.pathname,
        tags: {
          type: "unhandledrejection",
        },
      };
      if (!limiter.canSend(createClientEventKey(payload))) return;
      void sendClientMonitoringEvent(payload);
    }

    window.addEventListener("load", onLoad, true);
    window.addEventListener("error", onError, true);
    window.addEventListener("unhandledrejection", onUnhandledRejection);

    const originalConsoleError = console.error;
    let restoreConsole = () => {};

    if (shouldCaptureConsoleErrors()) {
      let isLogging = false;
      console.error = (...args: unknown[]) => {
        originalConsoleError.apply(console, args);
        if (isLogging) return;
        const message = serializeConsoleArgs(args);
        if (shouldIgnoreConsoleError(message)) return;
        const payload = {
          message: `Console Error: ${message}`,
          stack: extractConsoleStack(args),
          severity: "MEDIUM" as const,
          route: window.location.pathname,
          component: "Console Error",
          tags: { type: "console.error" },
        };
        if (!limiter.canSend(createClientEventKey(payload))) return;
        isLogging = true;
        void sendClientMonitoringEvent(payload).finally(() => {
          isLogging = false;
        });
      };
      restoreConsole = () => {
        console.error = originalConsoleError;
      };
    }

    return () => {
      window.removeEventListener("load", onLoad, true);
      window.removeEventListener("error", onError, true);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
      restoreConsole();
      restoreRequests();
    };
  }, []);

  return null;
}
