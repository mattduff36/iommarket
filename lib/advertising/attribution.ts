export const CAMPAIGN_PARAMETER_KEYS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "fbclid",
  "gclid",
  "gbraid",
  "wbraid",
] as const;

export type CampaignParameterKey = (typeof CAMPAIGN_PARAMETER_KEYS)[number];
export const ATTRIBUTION_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
const CAMPAIGN_VALUE = /^[A-Za-z0-9._~-]{1,80}$/;

export interface CampaignTouch {
  params: Partial<Record<CampaignParameterKey, string>>;
  capturedAt: string;
}

export interface StoredAttribution {
  first: CampaignTouch;
  last: CampaignTouch;
}

export function readCampaignParams(
  search: string,
): Partial<Record<CampaignParameterKey, string>> | null {
  let url: URL;
  try {
    url = new URL(search, "https://itrader.im");
  } catch {
    return null;
  }
  const params: Partial<Record<CampaignParameterKey, string>> = {};
  for (const key of CAMPAIGN_PARAMETER_KEYS) {
    const value = url.searchParams.get(key)?.trim();
    if (!value || !CAMPAIGN_VALUE.test(value) || value.includes("@")) continue;
    params[key] = value;
  }
  return Object.keys(params).length > 0 ? params : null;
}

function isFresh(touch: CampaignTouch, nowMs: number): boolean {
  const captured = Date.parse(touch.capturedAt);
  return Number.isFinite(captured) && nowMs - captured <= ATTRIBUTION_RETENTION_MS && nowMs >= captured;
}

export function parseStoredAttribution(raw: string | null | undefined, now = new Date()): StoredAttribution | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StoredAttribution;
    if (!parsed?.first?.capturedAt || !parsed?.last?.capturedAt || !parsed.first.params || !parsed.last.params) {
      return null;
    }
    const nowMs = now.getTime();
    if (!isFresh(parsed.first, nowMs) || !isFresh(parsed.last, nowMs)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function applyCampaignTouch(
  current: StoredAttribution | null,
  incoming: Partial<Record<CampaignParameterKey, string>> | null,
  now = new Date(),
): StoredAttribution | null {
  const fresh = current && isFresh(current.first, now.getTime()) && isFresh(current.last, now.getTime())
    ? current
    : null;
  if (!incoming) return fresh;
  const touch = { params: incoming, capturedAt: now.toISOString() };
  if (!fresh) return { first: touch, last: touch };
  return { first: fresh.first, last: touch };
}

export function summariseOutcomeCoverage(input: {
  measuredTotal: number | null;
  consentedAttributed: number | null;
}) {
  if (input.measuredTotal === null || input.consentedAttributed === null) {
    return { measuredTotal: null, consentedAttributed: null, unknown: null as number | null };
  }
  return {
    measuredTotal: input.measuredTotal,
    consentedAttributed: input.consentedAttributed,
    unknown: Math.max(0, input.measuredTotal - input.consentedAttributed),
  };
}
