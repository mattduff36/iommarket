"use client";

import { useEffect } from "react";
import { MonitoringErrorFallback } from "@/components/monitoring/error-fallback";
import { reportClientBoundaryError } from "@/lib/monitoring/client-ingest";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    void reportClientBoundaryError({
      error,
      component: "app/global-error.tsx",
    });
  }, [error]);

  return (
    <html lang="en" data-theme="dark">
      <body className="min-h-screen bg-canvas text-text-primary">
        <MonitoringErrorFallback title="Application error" onRetry={reset} />
      </body>
    </html>
  );
}
