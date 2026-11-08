"use client";

import { useEffect, useRef } from "react";
import { diagnosticTarget, installRequestDiagnostics } from "@/lib/monitoring/request-diagnostics";
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

    function onError(event: ErrorEvent) {
      const source = event.target instanceof HTMLImageElement ? event.target.currentSrc || event.target.src
        : event.target instanceof HTMLScriptElement ? event.target.src : null;
      const resource = source ? diagnosticTarget(source, window.location.origin) : null;
      const message = event.error instanceof Error
        ? event.error.message
        : event.message || (resource ? `Resource failed to load: ${resource}` : "Unhandled client error");
      const stack = event.error instanceof Error ? event.error.stack : undefined;
      if (shouldIgnoreClientMonitoringMessage(message)) return;
      const payload = {
        message,
        stack,
        severity: "HIGH" as const,
        route: window.location.pathname,
        tags: {
          type: "window.onerror",
          filename: event.filename ? diagnosticTarget(event.filename, window.location.origin) : resource,
          line: event.lineno,
          col: event.colno,
        },
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
      window.removeEventListener("error", onError, true);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
      restoreConsole();
      restoreRequests();
    };
  }, []);

  return null;
}
