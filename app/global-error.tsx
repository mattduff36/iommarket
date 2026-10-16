"use client";

import { useEffect, useState } from "react";
import { MonitoringErrorFallback } from "@/components/monitoring/error-fallback";
import { reportClientBoundaryError } from "@/lib/monitoring/client-ingest";

export default function GlobalError({
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
      component: "app/global-error.tsx",
    }).then((reference) => {
      if (active && reference) setSupportReference(reference);
    }).catch(() => { /* Diagnostics must not break recovery. */ });
    return () => {
      active = false;
    };
  }, [error]);

  return (
    <html lang="en" data-theme="dark">
      <body className="min-h-screen bg-canvas text-text-primary">
        <MonitoringErrorFallback
          title="Application error"
          onRetry={retry ?? reset}
          supportReference={supportReference}
        />
      </body>
    </html>
  );
}
