import { describe, expect, it } from "vitest";
import {
  buildCookieConsent,
  currentCookieConsentVersion,
  defaultCookieConsent,
  isAnalyticsAllowed,
  parseCookieConsent,
} from "@/lib/consent/cookie-consent";
import { getPolicyDefinition } from "@/lib/policies/registry";

describe("POL-COOKIE-001 cookie consent", () => {
  it("defaults analytics off before a decision", () => {
    expect(isAnalyticsAllowed(null)).toBe(false);
    expect(isAnalyticsAllowed(defaultCookieConsent())).toBe(false);
  });

  it("allows analytics only for the current policy version", () => {
    const accepted = buildCookieConsent(true);
    expect(accepted.version).toBe(currentCookieConsentVersion());
    expect(isAnalyticsAllowed(accepted)).toBe(true);
    expect(
      isAnalyticsAllowed({
        ...accepted,
        version: "stale-version",
      }),
    ).toBe(false);
  });

  it("binds consent to the cookies policy rather than a global version MD-POL-002", () => {
    expect(currentCookieConsentVersion()).toBe(
      getPolicyDefinition("cookies").version,
    );
  });

  it("parses and rejects malformed stored state", () => {
    expect(parseCookieConsent(JSON.stringify(buildCookieConsent(false)))).toMatchObject({
      analytics: false,
      version: currentCookieConsentVersion(),
    });
    expect(parseCookieConsent("not-json")).toBeNull();
    expect(parseCookieConsent(JSON.stringify({ accepted: true }))).toBeNull();
  });
});
