"use client";

import { useEffect } from "react";
import { MonitoringErrorFallback } from "@/components/monitoring/error-fallback";
import { reportClientBoundaryError } from "@/lib/monitoring/client-ingest";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    void reportClientBoundaryError({
      error,
      component: "app/error.tsx",
    });
  }, [error]);

  return <MonitoringErrorFallback title="Something went wrong" onRetry={reset} />;
}
