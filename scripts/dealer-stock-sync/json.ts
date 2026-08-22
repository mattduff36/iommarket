export function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function asString(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

export function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const numeric = Number(value.replace(/[^\d.-]+/g, ""));
    return Number.isFinite(numeric) ? numeric : null;
  }
  return null;
}

export function nested(record: Record<string, unknown>, path: string[]) {
  let current: unknown = record;
  for (const key of path) {
    const next = asRecord(current);
    if (!next) return null;
    current = next[key];
  }
  return current;
}

export function nestedString(record: Record<string, unknown> | null, path: string[]) {
  return asString(nested(record ?? {}, path));
}

export function nestedNumber(record: Record<string, unknown> | null, path: string[]) {
  return asNumber(nested(record ?? {}, path));
}

export function poundsToPence(pounds: number) {
  return Math.round(pounds * 100);
}

export function resolveMaybeUrl(value: string | null | undefined, origin?: string | null) {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("//")) return `https:${trimmed}`;
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
  if (origin && trimmed.startsWith("/")) {
    return `${origin.replace(/\/$/, "")}${trimmed}`;
  }
  return null;
}

export function normalizeImageUrl(value: string | null | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("//")) return `https:${trimmed}`;
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
  return null;
}

export function mapEngineSize(value: number | string | null | undefined) {
  if (value == null || value === "") return null;
  const numeric = typeof value === "number" ? value : Number(String(value).replace(/[^\d.]+/g, ""));
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  const litres = numeric > 10 ? numeric / 1000 : numeric;
  if (litres < 0.1 || litres > 10) return null;
  return Math.round(litres * 10) / 10;
}
