import { VehicleLookupError } from "@/lib/services/vehicle-check-error";

export async function fetchWithTimeout(
  input: string | URL,
  init?: RequestInit,
  timeoutMs = 15_000
): Promise<Response> {
  try {
    return await fetch(input, {
      ...init,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new VehicleLookupError("Lookup timed out", {
        code: "LOOKUP_TIMEOUT",
        status: 504,
      });
    }

    throw new VehicleLookupError(
      error instanceof Error ? error.message : "Lookup request failed",
      {
        code: "LOOKUP_REQUEST_FAILED",
        status: 502,
      }
    );
  }
}

export function toText(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
