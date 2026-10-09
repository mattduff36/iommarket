import { MIRROR_INTERVAL_MS } from "./limits";

export function nextAutomaticAt(lastSuccessMs: number | null, now: number): number | null {
  if (lastSuccessMs == null) return null;
  return lastSuccessMs + MIRROR_INTERVAL_MS;
}

export function automaticMirrorDue(lastSuccessMs: number | null, now: number): boolean {
  if (lastSuccessMs == null) return true;
  return now >= lastSuccessMs + MIRROR_INTERVAL_MS;
}

export function isoTime(value: number | null): string | null {
  if (value == null) return null;
  return new Date(value).toISOString();
}
