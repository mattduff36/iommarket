"use client";

import { useEffect, useRef } from "react";

interface ClientEventPayload {
  message: string;
  stack?: string;
  severity?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  route?: string;
  component?: string;
  tags?: Record<string, unknown>;
  extra?: Record<string, unknown>;
}

const MAX_EVENTS_PER_PAGE = 20;

async function sendClientEvent(payload: ClientEventPayload) {
  try {
    await fetch("/api/monitoring/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true,
    });
  } catch {
    // Monitoring should never crash the app.
  }
}

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
  const sentCountRef = useRef(0);

  useEffect(() => {
    function canSend() {
      if (sentCountRef.current >= MAX_EVENTS_PER_PAGE) return false;
      sentCountRef.current += 1;
      return true;
    }

    function onError(event: ErrorEvent) {
      if (!canSend()) return;

      const message = event.error instanceof Error
        ? event.error.message
        : event.message || "Unhandled client error";
      const stack = event.error instanceof Error ? event.error.stack : undefined;

      void sendClientEvent({
        message,
        stack,
        severity: "HIGH",
        route: window.location.pathname,
        tags: {
          type: "window.onerror",
          filename: event.filename,
          line: event.lineno,
          col: event.colno,
        },
      });
    }

    function onUnhandledRejection(event: PromiseRejectionEvent) {
      if (!canSend()) return;

      const message = stringifyReason(event.reason);
      const stack = event.reason instanceof Error ? event.reason.stack : undefined;

      void sendClientEvent({
        message,
        stack,
        severity: "MEDIUM",
        route: window.location.pathname,
        tags: {
          type: "unhandledrejection",
        },
      });
    }

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onUnhandledRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
    };
  }, []);

  return null;
}
