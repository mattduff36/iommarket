export interface MonitoringCursor {
  lastSeenAt: Date;
  id: string;
}

export function encodeMonitoringCursor(lastSeenAt: Date, id: string): string {
  return Buffer.from(`${lastSeenAt.toISOString()}|${id}`).toString("base64url");
}

export function decodeMonitoringCursor(value: string | undefined): MonitoringCursor | null {
  if (!value) return null;
  try {
    const decoded = Buffer.from(value, "base64url").toString("utf8");
    const separator = decoded.lastIndexOf("|");
    if (separator <= 0) return null;
    const lastSeenAt = new Date(decoded.slice(0, separator));
    const id = decoded.slice(separator + 1);
    if (Number.isNaN(lastSeenAt.getTime()) || !id) return null;
    return { lastSeenAt, id };
  } catch {
    return null;
  }
}
