"use client";

import { useRef, useState } from "react";
import { asActionFailure, publicErrorBody, type ActionFailure } from "./public-error";
import { isUncertainActionResult } from "./outcome-uncertainty";

const UNKNOWN = "We couldn't confirm that this change finished. Check the recorded result before trying again.";

/** Locks ambiguous writes until a full status-page navigation retrieves fresh data. */
export function useMutationRecovery() {
  const locked = useRef(false);
  const [blocked, setBlocked] = useState(false);

  async function run<T>(action: () => Promise<T>): Promise<T | ActionFailure> {
    const uncertain = () => asActionFailure(publicErrorBody({
      code: "unknown", retryable: false,
      message: typeof navigator !== "undefined" && navigator.onLine === false
        ? "Your browser reports that you are offline. Check your connection, then check the recorded result before trying again."
        : UNKNOWN,
    }));
    if (locked.current) return uncertain();
    let result: T | ActionFailure;
    try { result = await action(); } catch { result = uncertain(); }
    if (isUncertainActionResult(result)) {
      locked.current = true;
      setBlocked(true);
      return result ?? uncertain();
    }
    return result;
  }
  return { blocked, run };
}
