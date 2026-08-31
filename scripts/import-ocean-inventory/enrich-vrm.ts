import {
  isSupportedVehicleRegistration,
  normalizeRegistration,
} from "../../lib/utils/registration";

const PLACEHOLDER_VRMS = new Set([
  "TBC",
  "TBA",
  "NA",
  "N/A",
  "UNKNOWN",
  "NONE",
  "DEALER",
  "STOCK",
  "POA",
  "PLATE",
  "TRADE",
]);

export function isPlaceholderRegistration(raw: string | null | undefined) {
  if (!raw?.trim()) return true;
  const normalized = normalizeRegistration(raw);
  if (!normalized) return true;
  if (/^NEW/i.test(normalized)) return true;
  return PLACEHOLDER_VRMS.has(normalized);
}

export function usableRegistration(raw: string | null | undefined): string | null {
  if (!raw?.trim() || isPlaceholderRegistration(raw)) return null;
  if (!isSupportedVehicleRegistration(raw)) return null;
  return normalizeRegistration(raw);
}

export function uniqueUsableRegistrations(values: Array<string | null | undefined>) {
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const usable = usableRegistration(value);
    if (!usable || seen.has(usable)) continue;
    seen.add(usable);
    unique.push(usable);
  }
  return unique;
}

export function maskRegistration(raw: string) {
  const normalized = normalizeRegistration(raw);
  if (normalized.length <= 4) return "****";
  return `${normalized.slice(0, 2)}****${normalized.slice(-2)}`;
}
