"use client";

import { useEffect, useState } from "react";
import { MonitoringErrorFallback } from "@/components/monitoring/error-fallback";
import { reportClientBoundaryError } from "@/lib/monitoring/client-ingest";

export default function AppError({
  error,
  reset,
  retry,
}: {
  error: Error & { digest?: string };
  reset: () => void;
  retry?: () => void;
}) {
  const [supportReference, setSupportReference] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setSupportReference(null);
    void reportClientBoundaryError({
      error,
      component: "app/error.tsx",
    }).then((reference) => {
      if (active && reference) setSupportReference(reference);
    }).catch(() => { /* Diagnostics must not break recovery. */ });
    return () => {
      active = false;
    };
  }, [error]);

  return (
    <MonitoringErrorFallback
      title="Something went wrong"
      onRetry={retry ?? reset}
      supportReference={supportReference}
    />
  );
}
