import type { Instrumentation } from "next";
import { isServerCaptureEnabled } from "@/lib/monitoring/flags";
import { reportRequestError } from "@/lib/monitoring/on-request-error";

export const handleNodeRequestError: Instrumentation.onRequestError = async (
  error,
  request,
  context,
) => {
  try {
    if (!isServerCaptureEnabled()) return;
    await reportRequestError(error, request, context);
  } catch {
    // Monitoring must never alter the original request/error behavior.
  }
};
