export const TRANSPORT_AMBIGUOUS =
  "We couldn't tell whether that finished. Check your connection, then check the result before trying again.";
export const TRANSPORT_OFFLINE_HINT =
  "Your browser reports that you are offline. We couldn't tell whether that finished. Check the result before trying again.";

export function isTransportFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.name === "TypeError" ||
    error.name === "AbortError" ||
    error.name === "TimeoutError" ||
    /failed to fetch|networkerror|timeout|aborted/i.test(error.message)
  );
}

/** Browser online status is only a hint. A transport failure never claims the write succeeded or failed. */
export function transportPublicMessage(error: unknown, onlineHint?: boolean): string | null {
  if (!isTransportFailure(error)) return null;
  if (onlineHint === false) return TRANSPORT_OFFLINE_HINT;
  return TRANSPORT_AMBIGUOUS;
}

