import { COMPANY } from "@/lib/policy/company";

export const COOKIE_CONSENT_STORAGE_KEY = "itrader-cookie-consent";
export const COOKIE_CONSENT_COOKIE_NAME = "itrader-cookie-consent";

export interface CookieConsentState {
  version: string;
  analytics: boolean;
  decidedAt: string;
}

export function currentCookieConsentVersion() {
  return COMPANY.policyVersion;
}

export function defaultCookieConsent(): CookieConsentState {
  return {
    version: currentCookieConsentVersion(),
    analytics: false,
    decidedAt: "",
  };
}

export function parseCookieConsent(raw: string | null | undefined): CookieConsentState | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<CookieConsentState>;
    if (typeof parsed.version !== "string" || typeof parsed.analytics !== "boolean") {
      return null;
    }
    return {
      version: parsed.version,
      analytics: parsed.analytics,
      decidedAt: typeof parsed.decidedAt === "string" ? parsed.decidedAt : "",
    };
  } catch {
    return null;
  }
}

export function isAnalyticsAllowed(state: CookieConsentState | null) {
  if (!state) return false;
  if (state.version !== currentCookieConsentVersion()) return false;
  return state.analytics === true;
}

export function buildCookieConsent(
  analytics: boolean,
  decidedAt = new Date().toISOString(),
): CookieConsentState {
  return {
    version: currentCookieConsentVersion(),
    analytics,
    decidedAt,
  };
}

export function serializeCookieConsent(state: CookieConsentState) {
  return JSON.stringify(state);
}
