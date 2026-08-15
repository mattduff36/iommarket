const FORBIDDEN =
  /(password|token|secret|authorization|cookie|api[_-]?key|signature|webhook|email|merchant_reference|reference|body)/i;

export function sanitizeRippleLogValue(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (FORBIDDEN.test(trimmed) || trimmed.includes("@")) return undefined;
  return trimmed.slice(0, 64);
}

export function buildRippleSafeTags(
  tags: Record<string, string | number | boolean | null | undefined>
): Record<string, string> {
  const safe: Record<string, string> = {};
  for (const [key, value] of Object.entries(tags)) {
    if (FORBIDDEN.test(key)) continue;
    if (value === null || value === undefined) continue;
    const rendered = String(value);
    if (FORBIDDEN.test(rendered) || rendered.includes("@")) continue;
    safe[key] = rendered.slice(0, 64);
  }
  return safe;
}

export function assertRippleSafeMonitoringPayload(payload: unknown) {
  const serialized = JSON.stringify(payload);
  if (
    /x-ripple-signature|RIPPLE_WEBHOOK_SECRET|RIPPLE_REFERENCE_SECRET/i.test(
      serialized
    )
  ) {
    throw new Error("Monitoring payload leaked a Ripple secret");
  }
  if (/"[^"]*@[^"]+\.[^"]+"/.test(serialized)) {
    throw new Error("Monitoring payload leaked an email address");
  }
}
